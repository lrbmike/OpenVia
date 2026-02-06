/**
 * Agent Gateway - 编排层
 * 
 * 负责：
 * - 接收外部消息（来自 Bot）
 * - 维护 session 上下文
 * - 协调 LLM、Policy、Executor
 * 
 * 不做的事：
 * - 不执行工具（交给 Executor）
 * - 不做权限判断（交给 Policy）
 */


import type { LLMAdapter, ToolResult as LLMToolResult } from '../llm/adapter'
import type { ToolRegistry, ToolResult, ExecutionContext } from './registry'
import type { PolicyEngine, SessionContext } from './policy'
import { ToolExecutor } from './executor'

// ============================================================================
// 类型定义
// ============================================================================

/** Agent 事件流 */
export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_pending'; id: string; name: string; args: unknown; prompt: string }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult }
  | { type: 'done'; fullResponse: string }
  | { type: 'error'; message: string }

/** Agent 输入 */
import type { Message, ContentBlock } from '../types'

/** Agent 输入 */
export interface AgentInput {
  message: string | ContentBlock[]
  session: SessionContext
  systemPrompt?: string
  onPermissionRequest?: (prompt: string) => Promise<boolean>
}

/** Agent 配置 */
export interface AgentGatewayConfig {
  maxIterations?: number  // 最大工具调用轮次
}

// ============================================================================
// Agent Gateway 实现
// ============================================================================

export class AgentGateway {
  private llm: LLMAdapter
  private registry: ToolRegistry
  private policy: PolicyEngine
  private executor: ToolExecutor
  private config: AgentGatewayConfig
  
  constructor(
    llm: LLMAdapter,
    registry: ToolRegistry,
    policy: PolicyEngine,
    config: AgentGatewayConfig = {}
  ) {
    this.llm = llm
    this.registry = registry
    this.policy = policy
    this.executor = new ToolExecutor(registry)
    this.config = {
      maxIterations: config.maxIterations || 10
    }
  }
  
  /**
   * 处理用户消息
   */
  async *handleMessage(input: AgentInput): AsyncGenerator<AgentEvent> {
    const { message, session, systemPrompt, onPermissionRequest } = input
    
    // 构建执行上下文
    const execContext: ExecutionContext = {
      userId: session.userId,
      chatId: session.chatId,
      workDir: process.cwd()
    }
    
    // 获取工具 schemas
    const tools = this.registry.getSchemas()
    
    // 消息历史
    const messages: Message[] = [{ role: 'user', content: message }]
    
    // 完整响应
    let fullResponse = ''
    
    // 上一轮工具调用结果（跨迭代保存）
    let lastToolResults: LLMToolResult[] = []
    
    // 迭代处理（支持多轮工具调用）
    for (let iteration = 0; iteration < this.config.maxIterations!; iteration++) {
      const remaining = this.config.maxIterations! - iteration - 1
      console.log(`[Gateway] Iteration ${iteration + 1}/${this.config.maxIterations} (${remaining} remaining)`)
      console.log(`[Gateway] Calling LLM with ${messages.length} messages...`)
      
      // 收集当前轮的工具调用
      const pendingToolCalls: Array<{ id: string; name: string; args: unknown }> = []
      let hasText = false
      void hasText // Mark as used to suppress warning
      
      // 调用 LLM，传入上一轮的工具结果
      const toolResults = lastToolResults.length > 0 ? lastToolResults : undefined
      
      for await (const event of this.llm.chat({
        messages,
        tools,
        toolResults,
        systemPrompt
      })) {
        switch (event.type) {
          case 'text_delta':
            fullResponse += event.content
            hasText = true
            yield { type: 'text_delta', content: event.content }
            break
            
          case 'tool_call':
            if (event.name) {
              pendingToolCalls.push({
                id: event.id,
                name: event.name,
                args: event.args
              })
            } else {
              console.warn(`[Gateway] Ignored tool_call with no name (id: ${event.id})`)
            }
            break
            
          case 'error':
            yield { type: 'error', message: event.message }
            return
            
          case 'done':
            // 如果没有工具调用，返回结果
            if (pendingToolCalls.length === 0) {
              yield { type: 'done', fullResponse }
              return
            }
            break
        }
      }
      
      // 处理工具调用
      if (pendingToolCalls.length === 0) {
        console.log(`[Gateway] No tool calls, returning fullResponse (${fullResponse.length} chars): ${fullResponse.slice(0, 100)}...`)
        yield { type: 'done', fullResponse }
        return
      }
      
      // 收集工具结果
      const toolResultsForNextRound: LLMToolResult[] = []
      
      for (const tc of pendingToolCalls) {
        yield { type: 'tool_start', id: tc.id, name: tc.name, args: tc.args }
        
        // 获取工具定义
        const toolDef = this.registry.get(tc.name)
        if (!toolDef) {
          const result: ToolResult = { success: false, error: `Tool not found: ${tc.name}` }
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          toolResultsForNextRound.push({
            toolCallId: tc.id,
            content: JSON.stringify(result),
            isError: true
          })
          continue
        }
        
        // 评估策略
        const decision = await this.policy.evaluate({
          tool: toolDef,
          args: tc.args,
          session
        })
        
        // 记录审计
        this.policy.logAudit({
          userId: session.userId,
          chatId: session.chatId,
          tool: tc.name,
          args: tc.args,
          decision
        })
        
        // 根据决策处理
        let result: ToolResult
        
        if (decision.type === 'deny') {
          result = { success: false, error: decision.reason }
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          
        } else if (decision.type === 'require_approval') {
          yield { type: 'tool_pending', id: tc.id, name: tc.name, args: tc.args, prompt: decision.prompt }
          
          // 等待用户批准
          let approved = false
          if (onPermissionRequest) {
            approved = await onPermissionRequest(decision.prompt)
          }
          
          if (approved) {
            result = await this.executor.execute({
              toolName: tc.name,
              args: tc.args,
              context: execContext
            })
          } else {
            result = { success: false, error: 'User denied permission' }
          }
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          
        } else {
          // allow
          result = await this.executor.execute({
            toolName: tc.name,
            args: tc.args,
            context: execContext
          })
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
        }
        
        toolResultsForNextRound.push({
          toolCallId: tc.id,
          content: JSON.stringify(result),
          isError: !result.success
        })
      }
      
      // 保存到下一轮
      lastToolResults = toolResultsForNextRound
      
      // 将工具结果添加到消息历史
      // 添加 assistant 的工具调用消息
      messages.push({
        role: 'assistant',
        content: `[Tool calls: ${pendingToolCalls.map(t => t.name).join(', ')}]`
      })
      
      // 添加工具结果作为 user 消息
      messages.push({
        role: 'user',
        content: `Tool results:\n${toolResultsForNextRound.map(r => 
          `- ${r.toolCallId}: ${r.content}`
        ).join('\n')}`
      })
    }
    
    // 超过最大迭代次数
    console.log(`[Gateway] Max iterations (${this.config.maxIterations}) reached, stopping`)
    yield { type: 'error', message: `Max iterations (${this.config.maxIterations}) reached. Task may be incomplete.` }
  }
}
