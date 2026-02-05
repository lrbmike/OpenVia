/**
 * Claude CLI Wrapper (SDK Mode)
 *
 * Facade for the ClaudeSessionManager.
 * Handles the high-level logic of calling Claude via the official SDK.
 */

import { ClaudeSessionManager } from './claude-session-manager'
import type { ClaudeResponse } from '../types'
import { Logger } from '../utils/logger'
import type { AppConfig } from '../config'
import fs from 'node:fs/promises'
import { RequestContext } from '../utils/context'

const logger = new Logger('ClaudeCLI')

// Global Session Manager instance
let sessionManager: ClaudeSessionManager | null = null

/** Call Configuration */
export interface ClaudeCliConfig {
  workDir: string
  timeout: number
  // Fallback options are deprecated
  enableFallback?: boolean 
}

/**
 * .claudeignore template
 */
const CLAUDE_IGNORE_CONTENT = `# Claude Code Bot - .claudeignore
node_modules/
dist/
build/
.next/
out/
.cache/
*.log
.env
.env.local
.git/
.vscode/
.idea/
.DS_Store
Thumbs.db
coverage/
*.tmp
*.temp
`

/**
 * Ensure working directory and config files exist
 */
export async function ensureWorkDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  const ignoreFilePath = `${dir}/.claudeignore`
  try {
    await fs.access(ignoreFilePath)
  } catch {
    await fs.writeFile(ignoreFilePath, CLAUDE_IGNORE_CONTENT, 'utf-8')
    logger.info(`Created .claudeignore in ${dir}`)
  }
}

/**
 * Initialize the Claude Session Manager
 */
export async function initClaudeClient(config: AppConfig['claude'], workDir?: string) {
  if (sessionManager) return

  const cwd = workDir || process.cwd()
  logger.info(`[Claude] Initializing Session Manager in ${cwd}...`)
  
  await ensureWorkDir(cwd)
  
  sessionManager = new ClaudeSessionManager(config, cwd)
  
  logger.info('[Claude] Session Manager initialized.')
}

/**
 * Stop all Claude sessions
 */
export async function stopClaudeClient() {
  if (sessionManager) {
    await sessionManager.stopAll()
    sessionManager = null
    logger.info('[Claude] All sessions stopped.')
  }
}

/**
 * Send a message to Claude and get the response
 */
export async function callClaude(
  input: string,
  _context: {
    skillResult?: { skill: string; result: unknown }
    config: ClaudeCliConfig
  },
  sdkContext?: RequestContext
): Promise<ClaudeResponse> {
  if (!sessionManager) {
    throw new Error('Claude Session Manager not initialized. Please call initClaudeClient first.')
  }

  if (!sdkContext) {
    logger.warn('No SDK Context provided to callClaude, permissions may fail.')
    throw new Error('Internal Error: sdkContext is required for callClaude')
  }

  logger.info(`[Claude] Processing message from user ${sdkContext.userId}: ${input.slice(0, 50)}...`)

  try {
    // Get or create session for this specific user
    const client = await sessionManager.getOrCreateSession(sdkContext.userId)
    
    const responseText = await client.sendMessage(input, sdkContext)
    return {
      action: 'reply',
      message: responseText
    }

  } catch (error) {
    logger.error('Claude SDK call failed:', error)
    return {
      action: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Destroy a specific user's session (e.g., on /reset command)
 */
export async function resetUserSession(userId: string): Promise<boolean> {
  if (!sessionManager) {
    return false
  }
  return await sessionManager.destroySession(userId)
}

/**
 * Get current active session count
 */
export function getActiveSessionCount(): number {
  return sessionManager?.getActiveSessionCount() ?? 0
}
