import { callClaude, ensureWorkDir } from '../ai'
import { getSession } from './session'
import { isUserAllowed, logAudit } from './policy'
import { Logger } from '../utils/logger'
import { runWithContext } from '../utils/context'

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

/**
 * Handle user message (Orchestrator core loop)
 */
export async function handleMessage(
  input: string,
  userId: string,
  channelId: string,
  sendReply: (text: string) => Promise<void>
): Promise<void> {
  logger.info(`Handling message from ${userId} via ${channelId}: ${input.slice(0, 50)}...`)

  return runWithContext({ userId, channelId, sendReply }, async () => {
    // Permission check
    if (!isUserAllowed(userId)) {
      logAudit({ userId, action: 'message', result: 'denied', reason: 'User not in whitelist' })
      await sendReply("Sorry, you don't have permission to use this Bot.")
      return
    }

    logAudit({ userId, action: 'message', result: 'allowed' })

    const session = getSession(userId, userId)

    // Construct initial Context
    const context = {
      history: session.history, 
      config: {
        workDir: routerConfig.workDir,
        timeout: routerConfig.timeout
      }
    }

    // Add user message to history
    session.history.push({ role: 'user', content: input })

    // Call Claude SDK (SDK handles tool calls and multi-step reasoning internally)
    const response = await callClaude(input, context)

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
