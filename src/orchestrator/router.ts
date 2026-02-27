/**
 * Orchestrator Router
 *
 * 支持双模式：
 * - 普通消息：走原有 callAgent 单轮模式
 * - Goal 模式：/goal 命令触发，走 GoalLoop 多步执行
 */

import { callAgent, ensureWorkDir, getLLMAdapter } from '../ai'
import { getSession } from './session'
import { isUserAllowed, logAudit } from './policy'
import { Logger } from '../utils/logger'
import { runWithContext } from '../utils/context'
import { runGoalLoop } from '../goal/goal-loop'

const logger = new Logger('Router')

export interface RouterConfig {
  workDir: string
  maxSteps: number // Deprecated but kept for type compatibility
  timeout: number
}

let routerConfig: RouterConfig = {
  workDir: '.openvia',
  maxSteps: 5,
  timeout: 120000,
}

/** Initialize router configuration */
export async function initRouter(config: Partial<RouterConfig>): Promise<void> {
  routerConfig = { ...routerConfig, ...config }
  await ensureWorkDir(routerConfig.workDir)
  logger.info(`Initialized with workDir: ${routerConfig.workDir}`)
}

/**
 * Get router configuration
 */
export function getRouterConfig(): RouterConfig {
  return { ...routerConfig }
}

import type { ContentBlock } from '../types/protocol'

// ============================================================================
// Goal 命令解析
// ============================================================================

/** 解析 /goal 命令，返回目标描述；非 /goal 消息返回 null */
function parseGoalCommand(input: string | ContentBlock[]): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed.startsWith('/goal ')) {
    return trimmed.slice(6).trim()
  }
  if (trimmed === '/goal') {
    return null // 空的 /goal 命令，不触发
  }
  return null
}

// ============================================================================
// 消息处理
// ============================================================================

/**
 * Handle user message (Orchestrator core loop)
 *
 * 支持两种模式：
 * 1. /goal <描述> → Goal-Driven 模式（GoalLoop）
 * 2. 普通消息 → 单轮 Agent 模式（callAgent）
 */
export async function handleMessage(
  input: string | ContentBlock[],
  userId: string,
  channelId: string,
  sendReply: (text: string) => Promise<void>
): Promise<void> {
  const logContent = typeof input === 'string' ? input : '[Multimedia Message]'
  logger.info(`Handling message from ${userId} via ${channelId}: ${logContent.slice(0, 50)}...`)

  return runWithContext({ userId, channelId, sendReply }, async () => {
    // Permission check
    if (!isUserAllowed(userId, channelId)) {
      logAudit({ userId, action: 'message', result: 'denied', reason: 'User not in whitelist' })
      await sendReply("Sorry, you don't have permission to use this Bot.")
      return
    }

    logAudit({ userId, action: 'message', result: 'allowed' })

    const session = getSession(userId, channelId)

    // Add user message to history
    session.history.push({ role: 'user', content: input })

    // ── 检查是否为 Goal 命令 ──
    const goalDescription = parseGoalCommand(input)

    if (goalDescription) {
      // Goal-Driven 模式
      logger.info(`Goal mode activated: "${goalDescription.slice(0, 50)}..."`)

      const llm = getLLMAdapter()
      if (!llm) {
        await sendReply('❌ Agent 未初始化，无法启动目标模式。')
        return
      }

      const requestContext = { userId, channelId, sendReply }

      try {
        const result = await runGoalLoop(
          llm,
          goalDescription,
          userId,
          requestContext,
          [...session.history], // 传入历史副本
        )

        // 记录目标 ID 到 session
        session.activeGoalId = result.goalId

        // GoalLoop 内部已通过 sendReply 发送了进度更新
        // 这里将最终总结添加到历史
        session.history.push({
          role: 'assistant',
          content: `[Goal ${result.completed ? 'Completed' : 'Incomplete'}] ${result.summary}`
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.error(`Goal loop error: ${msg}`)
        await sendReply(`❌ 目标执行出错: ${msg}`)
      }

      return
    }

    // ── 普通单轮模式 ──
    const requestContext = { userId, channelId, sendReply }
    const response = await callAgent(
      input,
      { history: session.history },
      requestContext
    )

    if (response.action === 'reply' && response.message) {
        await sendReply(response.message)
        session.history.push({ role: 'assistant', content: response.message })
    } else if (response.action === 'error') {
        await sendReply(`❌ Error: ${response.message}`)
    } else {
        await sendReply('(No content returned)')
    }
  })
}
