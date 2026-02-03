import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import type { SDKSession, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { PermissionBridge } from '../utils/permission-bridge'

import type { AppConfig } from '../config'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export class ClaudeSDKClient {
  private session: SDKSession | null = null
  private logger = console
  private permissionBridge = PermissionBridge.getInstance()
 
  constructor() {}
 
  /**
   * Detect Claude Code executable path
   */
  private detectClaudePath(): string | undefined {
    // 1. Try PATH
    try {
      const stdout = execSync('which claude', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (stdout && existsSync(stdout)) {
        return stdout
      }
    } catch {
      // ignore
    }
 
    // 2. Try common home locations
    const commonPaths = [
      join(homedir(), '.local/bin/claude'),
      join(homedir(), 'node_modules/.bin/claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ]
 
    for (const p of commonPaths) {
      if (existsSync(p)) {
        return p
      }
    }
 
    return undefined
  }

  async initialize(config: AppConfig['claude']) {
    this.logger.info('[ClaudeSDK] Initializing Claude Agent SDK...')
    
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      this.logger.warn('[ClaudeSDK] ANTHROPIC_API_KEY is missing from both config and env.')
    } else {
      // Safely log the presence of the key
      this.logger.info(`[ClaudeSDK] API Key found (starts with: ${apiKey.slice(0, 10)}..., length: ${apiKey.length})`)
      // Inject into current process env just in case
      process.env.ANTHROPIC_API_KEY = apiKey
    }
    
    this.logger.info(`[ClaudeSDK] Config - Model: ${config.model}`)
    if (config.baseUrl) {
      this.logger.info(`[ClaudeSDK] Config - Base URL: ${config.baseUrl}`)
      process.env.ANTHROPIC_BASE_URL = config.baseUrl
    }

    try {
      this.session = unstable_v2_createSession({
        model: config.model,
        // Auto-detect runtime (node/bun/deno)
        executable: undefined,
        // Path to Claude Code executable (especially needed when compiled via Bun)
        pathToClaudeCodeExecutable: config.executablePath || this.detectClaudePath(),
        env: {
            ...process.env as Record<string, string | undefined>,
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_BASE_URL: config.baseUrl || process.env.ANTHROPIC_BASE_URL,
            CLAUDE_MODEL: config.model,
        },
        // Bypass permission prompt if configured
        permissionMode: config.permissionMode || 'default',
        
        // Permission Handler
        canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
            const toolInput = input as any
            
             // 1. Auto-allow read-only tools if desired
            if (['Read', 'Glob', 'Grep', 'LS', 'View'].includes(toolName)) {
                 return { behavior: 'allow', toolUseID: options.toolUseID, updatedInput: toolInput }
            }
 
            // 2. Shell Whitelist Check
            if (toolName === 'Bash' && config.shellWhitelist) {
                 const command = (toolInput.command || '').trim()
                 const whitelist = config.shellWhitelist
                 const cmdName = command.split(' ')[0]
                 if (whitelist.includes(cmdName)) {
                     this.logger.info(`[Permission] Auto-allowing whitelisted command: ${cmdName}`)
                     return { behavior: 'allow', toolUseID: options.toolUseID, updatedInput: toolInput }
                 }
            }
            
            // 3. Request Permission via Bridge (Telegram)
            this.logger.info(`[Permission] Requesting approval for ${toolName}`)
            
            // Construct a readable message for the user
            let message = `⚠️ *Permission Request*\n\nTool: \`${toolName}\`\n`
            if (toolName === 'Bash') {
                message += `Command: \`${toolInput.command}\``
            } else if (toolName === 'Edit' || toolName === 'Write') {
                message += `File: \`${toolInput.path}\``
            } else {
                message += `Arguments: \`${JSON.stringify(toolInput).slice(0, 100)}...\``
            }

            const decision = await this.permissionBridge.request(message)
            
            if (decision === 'allow') {
                 return { behavior: 'allow', toolUseID: options.toolUseID, updatedInput: toolInput }
            } else {
                 return { behavior: 'deny', message: 'User denied permission via Telegram', toolUseID: options.toolUseID }
            }
        }
      })

      this.logger.info(`[ClaudeSDK] Session created. (ID available after first interaction)`)
      
    } catch (error) {
      this.logger.error('[ClaudeSDK] Failed to initialize session:', error)
      throw error
    }
  }

  async sendMessage(message: string): Promise<string> {
    if (!this.session) {
      throw new Error('Claude SDK session not initialized')
    }

    await this.session.send(message)

    let fullResponse = ''
    try {
      // Stream the response
      for await (const msg of this.session.stream()) {
          this.logger.debug(`[ClaudeSDK] Stream Msg: ${JSON.stringify(msg)}`)
          // Handle different message types from the SDK
          switch (msg.type) {
              case 'stream_event':
                  if (msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
                      fullResponse += msg.event.delta.text
                  }
                  break;
              
              case 'assistant':
                  // Assistant event handling (full block accumulated in result)
                  break;

              case 'result':
                  if (msg.subtype === 'success') {
                      this.logger.debug('[ClaudeSDK] Result success')
                      if (msg.result) {
                          fullResponse = msg.result
                      }
                      return fullResponse 
                  } else if (msg.subtype === 'error_during_execution') {
                       this.logger.error('[ClaudeSDK] Execution error', msg)
                       return `❌ Error during execution: ${JSON.stringify(msg)}`
                  }
                  break;
              
              case 'user':
              case 'system':
              case 'tool_progress':
              case 'tool_use_summary':
              case 'auth_status':
                  break;
          }
      }
    } catch (err) {
      this.logger.error('[ClaudeSDK] Error streaming response:', err)
      throw err
    }

    return fullResponse
  }

  async stop() {
    if (this.session) {
      this.session.close()
      this.session = null
      this.logger.info('[ClaudeSDK] Session closed')
    }
  }
}
