/**
 * Agent Gateway - Orchestration Layer
 * 
 * Responsibilities:
 * - Receive external messages (from Bot)
 * - Maintain session context
 * - Coordinate LLM, Policy, Executor
 * 
 * Does NOT:
 * - Execute tools (delegated to Executor)
 * - Make permission decisions (delegated to Policy)
 */


import type { LLMAdapter, ToolResult as LLMToolResult } from '../llm/adapter'
import type { ToolRegistry, ToolResult, ExecutionContext } from './registry'
import type { PolicyEngine, SessionContext } from './policy'
import { ToolExecutor } from './executor'
import { Logger } from '../utils/logger'

const logger = new Logger('Gateway')

// ============================================================================
// Type Definitions
// ============================================================================

/** Agent event stream */
export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_pending'; id: string; name: string; args: unknown; prompt: string }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult }
  | { type: 'done'; fullResponse: string }
  | { type: 'error'; message: string }

/** Agent input */
import type { Message, ContentBlock } from '../types'

/** Agent input */
export interface AgentInput {
  message: string | ContentBlock[]
  history?: Message[]
  session: SessionContext
  systemPrompt?: string
  onPermissionRequest?: (prompt: string) => Promise<boolean>
  maxIterations?: number
}

/** Agent configuration */
export interface AgentGatewayConfig {
  maxIterations?: number  // Max tool call iterations
}

// ============================================================================
// Agent Gateway Implementation
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
   * Handle user message
   */
  async *handleMessage(input: AgentInput): AsyncGenerator<AgentEvent> {
    const { message, history, session, systemPrompt, onPermissionRequest } = input
    
    // Build execution context
    const execContext: ExecutionContext = {
      userId: session.userId,
      chatId: session.chatId,
      workDir: process.cwd()
    }
    
    // Get tool schemas
    const tools = this.registry.getSchemas()
    
    // Message history:
    // - Keep upstream history
    // - Ensure current user input is present (avoid dropping step instruction in GoalLoop)
    const messages: Message[] = history && history.length > 0 ? [...history] : []
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user' || !isSameContent(last.content, message)) {
      messages.push({ role: 'user', content: message })
    }
    
    // Full response accumulator
    let fullResponse = ''
    
    // Previous round tool results (persisted across iterations)
    let lastToolResults: LLMToolResult[] = []
    let previousResponseId: string | undefined
    const successfulToolCallCounts = new Map<string, number>()
    const MAX_IDENTICAL_CALLS_AFTER_SUCCESS = 1
    const maxIterations = input.maxIterations ?? this.config.maxIterations!
    
    // Iterative processing (supports multi-round tool calls)
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const remaining = maxIterations - iteration - 1
      logger.info(`[Gateway] Iteration ${iteration + 1}/${maxIterations} (${remaining} remaining)`)
      logger.info(`[Gateway] Calling LLM with ${messages.length} messages...`)
      
      // Collect current round tool calls
      const pendingToolCalls: Array<{ id: string; name: string; args: unknown; meta?: Record<string, unknown> }> = []
      let hasText = false
      void hasText // Mark as used to suppress warning
      
      // Call LLM, pass in previous round tool results
      const toolResults = lastToolResults.length > 0 ? lastToolResults : undefined
      
      try {
        for await (const event of this.llm.chat({
          messages,
          tools,
          toolResults,
          systemPrompt,
          previousResponseId
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
                  args: event.args,
                  meta: event.meta
                })
              } else {
                logger.warn(`[Gateway] Ignored tool_call with no name (id: ${event.id})`)
              }
              break
              
            case 'error':
              yield { type: 'error', message: event.message }
              return
              
            case 'done':
              if (event.responseId) {
                previousResponseId = event.responseId
              }
              // If no tool calls, return result
              if (pendingToolCalls.length === 0) {
                yield { type: 'done', fullResponse }
                return
              }
              break
          }
        }
      } catch (error) {
        const err = error as Error
        logger.error(
          `[Gateway] LLM call failed: ${err?.name || 'Error'} ${err?.message || String(error)}`
        )
        if (err?.stack) {
          logger.error(`[Gateway] LLM call stack: ${err.stack}`)
        }
        yield { type: 'error', message: err?.message || String(error) }
        return
      }
      
      // Process tool calls
      if (pendingToolCalls.length === 0) {
        logger.info(`[Gateway] No tool calls, returning fullResponse (${fullResponse.length} chars): ${fullResponse.slice(0, 100)}...`)
        yield { type: 'done', fullResponse }
        return
      }
      
      // Collect tool results
      const toolResultsForNextRound: LLMToolResult[] = []
      const seenInCurrentRound = new Set<string>()
      
      for (const tc of pendingToolCalls) {
        const fp = buildToolFingerprint(tc.name, tc.args)
        const successCount = successfulToolCallCounts.get(fp) || 0

        if (seenInCurrentRound.has(fp) || successCount > MAX_IDENTICAL_CALLS_AFTER_SUCCESS) {
          const result: ToolResult = {
            success: false,
            error: `Duplicate tool call blocked for "${tc.name}". Reuse previous result and provide the answer.`,
          }
          logger.warn(`[Gateway] Blocked duplicate tool call: ${fp}`)
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          toolResultsForNextRound.push({
            toolCallId: tc.id,
            toolName: tc.name,
            toolArgs: tc.args,
            toolCallMeta: tc.meta,
            content: JSON.stringify(result),
            isError: true
          })
          continue
        }
        seenInCurrentRound.add(fp)

        yield { type: 'tool_start', id: tc.id, name: tc.name, args: tc.args }
        
        // Get tool definition
        const toolDef = this.registry.get(tc.name)
        if (!toolDef) {
          const result: ToolResult = { success: false, error: `Tool not found: ${tc.name}` }
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          toolResultsForNextRound.push({
            toolCallId: tc.id,
            toolName: tc.name,
            toolArgs: tc.args,
            toolCallMeta: tc.meta,
            content: JSON.stringify(result),
            isError: true
          })
          continue
        }
        
        // Evaluate policy
        const decision = await this.policy.evaluate({
          tool: toolDef,
          args: tc.args,
          session
        })
        
        // Log audit
        this.policy.logAudit({
          userId: session.userId,
          chatId: session.chatId,
          tool: tc.name,
          args: tc.args,
          decision
        })
        
        // Process based on decision
        let result: ToolResult
        
        if (decision.type === 'deny') {
          result = { success: false, error: decision.reason }
          yield { type: 'tool_result', id: tc.id, name: tc.name, result }
          
        } else if (decision.type === 'require_approval') {
          yield { type: 'tool_pending', id: tc.id, name: tc.name, args: tc.args, prompt: decision.prompt }
          
          // Wait for user approval
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
          toolName: tc.name,
          toolArgs: tc.args,
          toolCallMeta: tc.meta,
          content: JSON.stringify(result),
          isError: !result.success
        })

        if (result.success) {
          successfulToolCallCounts.set(fp, successCount + 1)
        }
      }
      
      // Save for next round
      lastToolResults = toolResultsForNextRound
    }
    
    // Max iterations exceeded
    logger.warn(`[Gateway] Max iterations (${maxIterations}) reached, stopping`)
    yield { type: 'error', message: `Max iterations (${maxIterations}) reached. Task may be incomplete.` }
  }
}

function isSameContent(a: Message['content'], b: Message['content']): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function buildToolFingerprint(name: string, args: unknown): string {
  return `${name}:${stableStringify(args)}`
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}
