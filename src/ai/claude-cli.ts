/**
 * Claude CLI Wrapper (SDK Mode)
 *
 * Facade for the ClaudeSDKClient.
 * Handles the high-level logic of calling Claude via the official SDK.
 */

import { ClaudeSDKClient } from './claude-sdk'
import type { ClaudeResponse, Message, SkillDescription } from '../types'
import { Logger } from '../utils/logger'
import fs from 'node:fs/promises'

const logger = new Logger('ClaudeCLI')

// Global Claude client instance
let claudeClient: ClaudeSDKClient | null = null

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
 * Initialize the Claude Agent SDK client
 */
export async function initClaudeClient(workDir?: string) {
  if (claudeClient) return

  const cwd = workDir || process.cwd()
  logger.info(`[Claude] Initializing SDK client in ${cwd}...`)
  
  await ensureWorkDir(cwd)
  
  claudeClient = new ClaudeSDKClient()
  await claudeClient.initialize()
  
  logger.info('[Claude] SDK client initialized.')
}

/**
 * Stop the Claude client
 */
export async function stopClaudeClient() {
  if (claudeClient) {
    await claudeClient.stop()
    claudeClient = null
    logger.info('[Claude] Client stopped.')
  }
}

/**
 * Send a message to Claude and get the response
 */
export async function callClaude(
  input: string,
  context: {
    history?: Message[]
    skills?: SkillDescription[]
    skillResult?: { skill: string; result: unknown }
    config: ClaudeCliConfig
  }
): Promise<ClaudeResponse> {
  if (!claudeClient) {
    await initClaudeClient(context.config.workDir)
  }

  if (!claudeClient) {
    throw new Error('Failed to initialize Claude client')
  }

  if (!claudeClient) {
    throw new Error('Failed to initialize Claude client')
  }

  logger.info(`Calling Claude SDK with message: ${input.slice(0, 50)}...`)

  try {
    const responseText = await claudeClient.sendMessage(input)
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
