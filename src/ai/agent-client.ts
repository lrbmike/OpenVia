/**
 * Agent Client - 新架构统一入口
 * 
 * 替代旧的 claude-cli.ts / claude-sdk.ts
 * 使用新的 LLM Adapter + Agent Core 架构
 */

import { createLLMAdapter, type LLMAdapter, type LLMConfig } from '../llm'
import { ToolRegistry, getToolRegistry, PolicyEngine, getPolicyEngine, AgentGateway } from '../core'
import { coreTools } from '../tools'
import { loadSkills, getDefaultSkillsDir } from '../skills'
import type { AppConfig } from '../config'
import { Logger } from '../utils/logger'

const logger = new Logger('AgentClient')

// ============================================================================
// 类型定义
// ============================================================================

export interface AgentClientConfig {
  llm: AppConfig['llm']
  systemPrompt?: string
}

export interface RequestContext {
  userId: string
  channelId: string
  sendReply: (text: string) => Promise<void>
}

// ============================================================================
// 全局状态
// ============================================================================

let llmAdapter: LLMAdapter | null = null
let agentGateway: AgentGateway | null = null
let toolRegistry: ToolRegistry | null = null
let policyEngine: PolicyEngine | null = null
let systemPrompt: string = ''
let workDir: string = process.cwd()

// ============================================================================
// 初始化
// ============================================================================

/**
 * 初始化 Agent 客户端
 */
export async function initAgentClient(
  config: AgentClientConfig,
  sessionsDir?: string
): Promise<void> {
  logger.info('Initializing Agent Client with new architecture...')
  
  // 设置工作目录
  if (sessionsDir) {
    workDir = sessionsDir
  }
  
  // 保存基础 system prompt
  let basePrompt = config.systemPrompt || config.llm.systemPrompt || ''
  
  // 加载用户 Skills（只记录列表，不注入完整内容）
  const skillsDir = getDefaultSkillsDir()
  const { skills, errors } = await loadSkills(skillsDir)
  if (errors.length > 0) {
    logger.warn(`Skills loading had ${errors.length} errors`)
  }
  if (skills.length > 0) {
    // 只注入 Skills 列表，让 LLM 按需调用 read_skill 获取完整内容
    const skillsList = skills.map(s => 
      `- ${s.id}: ${s.metadata.name}${s.metadata.description ? ` - ${s.metadata.description}` : ''}`
    ).join('\n')
    
    const skillsPrompt = `
## Available Skills

You have access to the following user-defined skills. Use \`list_skills\` to see them, and \`read_skill\` to read the full instructions when needed.

${skillsList}
`
    basePrompt = basePrompt + '\n' + skillsPrompt
    logger.info(`Loaded ${skills.length} user skills: ${skills.map(s => s.id).join(', ')}`)
  }
  systemPrompt = basePrompt
  
  // 1. 创建 LLM Adapter
  const llmConfig: LLMConfig = {
    format: config.llm.format,
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    timeout: config.llm.timeout,
    maxTokens: config.llm.maxTokens,
    temperature: config.llm.temperature
  }
  
  llmAdapter = await createLLMAdapter(llmConfig)
  logger.info(`LLM Adapter created: ${llmAdapter.name} (${llmAdapter.model})`)
  
  // 2. 初始化 Tool Registry
  toolRegistry = getToolRegistry()
  toolRegistry.registerAll(coreTools)
  logger.info(`Registered ${coreTools.length} core tools`)
  
  // 3. 初始化 Policy Engine
  policyEngine = getPolicyEngine()
  if (config.llm.shellConfirmList) {
    policyEngine.setShellConfirmList(config.llm.shellConfirmList)
  }
  logger.info('Policy Engine initialized')
  
  // 4. 创建 Agent Gateway
  agentGateway = new AgentGateway(llmAdapter, toolRegistry, policyEngine, {
    maxIterations: 10
  })
  logger.info('Agent Gateway created')
  
  logger.info('Agent Client initialized successfully!')
}

/**
 * 停止 Agent 客户端
 */
export function stopAgentClient(): void {
  logger.info('Stopping Agent Client...')
  llmAdapter = null
  agentGateway = null
  // Registry 和 Policy 是单例，保留
}

// ============================================================================
// 消息处理
// ============================================================================

/**
 * 调用 Agent 处理消息
 * 
 * 返回格式与旧 `callClaude` 兼容
 */
export async function callAgent(
  message: string,
  _context: { history: unknown[] },
  requestContext: RequestContext
): Promise<{ action: 'reply' | 'error'; message?: string }> {
  if (!agentGateway) {
    return { action: 'error', message: 'Agent not initialized' }
  }
  
  const { userId, channelId, sendReply } = requestContext
  
  try {
    let fullResponse = ''
    let lastTextEvent = ''
    
    // 权限请求处理器 - 使用 PermissionBridge 实现真正的用户等待
    const onPermissionRequest = async (prompt: string): Promise<boolean> => {
      const { PermissionBridge } = await import('../utils/permission-bridge')
      const bridge = PermissionBridge.getInstance()
      
      // 构建 RequestContext 用于 PermissionBridge
      const reqContext = {
        userId,
        channelId,
        sendReply
      }
      
      const decision = await bridge.request(prompt, reqContext)
      return decision === 'allow'
    }
    
    // 处理 Agent 事件流
    for await (const event of agentGateway.handleMessage({
      message,
      session: { userId, chatId: channelId },
      systemPrompt,
      onPermissionRequest
    })) {
      switch (event.type) {
        case 'text_delta':
          fullResponse += event.content
          lastTextEvent = event.content
          // 可用于流式输出
          break
          
        case 'tool_start':
          logger.debug(`Tool started: ${event.name}`)
          break
          
        case 'tool_pending':
          logger.debug(`Tool pending approval: ${event.name}`)
          break
          
        case 'tool_result':
          if (!event.result.success) {
            logger.warn(`Tool ${event.name} failed: ${event.result.error}`)
          }
          break
          
        case 'done':
          return { action: 'reply', message: event.fullResponse || fullResponse }
          
        case 'error':
          return { action: 'error', message: event.message }
      }
    }
    
    return { action: 'reply', message: fullResponse }
    
  } catch (error) {
    logger.error('Agent call failed:', error)
    return {
      action: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取当前 LLM 信息
 */
export function getLLMInfo(): { name: string; model: string } | null {
  if (!llmAdapter) return null
  return { name: llmAdapter.name, model: llmAdapter.model }
}

/**
 * 获取工作目录
 */
export function getWorkDir(): string {
  return workDir
}

/**
 * 确保工作目录存在（兼容旧接口）
 */
export async function ensureWorkDir(dir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  workDir = dir
}
