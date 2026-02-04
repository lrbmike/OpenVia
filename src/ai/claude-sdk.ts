import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'
import type { SDKSession, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { buildCombinedSystemPrompt } from './prompts'
import { PermissionBridge } from '../utils/permission-bridge'
import { RequestContext } from '../utils/context'
import { Mutex } from 'async-mutex'

import type { AppConfig } from '../config'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export class ClaudeSDKClient {
  private session: SDKSession | null = null
  private logger = console
  private permissionBridge = PermissionBridge.getInstance()
  private mutex = new Mutex()
  private currentContext: RequestContext | null = null
 
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
      // Build Combine System Prompt
      const combinedPrompt = buildCombinedSystemPrompt(config.systemPrompt)
      this.logger.debug(`[ClaudeSDK] System Prompt Appended: ${config.systemPrompt ? 'Yes' : 'No'}`)

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
        // System Prompt Injection
        // We use the 'preset' type to retain Claude Code's default coding capabilities
        // and APPEND our OpenVia context + User custom prompt.
        // @ts-ignore: SDK types might be behind, confirmed in d.ts
        systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: combinedPrompt
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
 
            // 2. Shell Permission Policy (Confirmation List Mode)
            if (toolName === 'Bash') {
                const command = (toolInput.command || '').trim()
                
                // Allow everything EXCEPT commands that strictly require confirmation
                const confirmList = config.shellConfirmList || []
                const requiresConfirmation = confirmList.some(item => {
                    // Simple inclusion check. 
                    return command.includes(item)
                })

                if (!requiresConfirmation) {
                    this.logger.info(`[Permission] Auto-allowing command (not in confirm list): ${command.slice(0, 30)}...`)
                    return { behavior: 'allow', toolUseID: options.toolUseID, updatedInput: toolInput }
                } else {
                     this.logger.warn(`[Permission] Command matched confirm list: ${command}`)
                     // Fall through to manual permission request
                }
            }
            
            // 3. Request Permission via Bridge
            this.logger.info(`[Permission] Requesting approval for ${toolName}`)
            
            if (!this.currentContext) {
                 this.logger.error('[Permission] CRITICAL: No active request context in ClaudeSDKClient. Denying permission.')
                 return { behavior: 'deny', message: 'Internal Error: Context lost', toolUseID: options.toolUseID }
            }

            // Construct a readable message for the user
            let message = `⚠️ *Permission Request*\n\nTool: \`${toolName}\`\n`
            if (toolName === 'Bash') {
                message += `Command: \`${toolInput.command}\``
            } else if (toolName === 'Edit' || toolName === 'Write') {
                message += `File: \`${toolInput.path}\``
            } else {
                message += `Arguments: \`${JSON.stringify(toolInput).slice(0, 100)}...\``
            }

            // Pass the explicitly stored context to the bridge
            const decision = await this.permissionBridge.request(message, this.currentContext)
            
            if (decision === 'allow') {
                 return { behavior: 'allow', toolUseID: options.toolUseID, updatedInput: toolInput }
            } else {
                 return { behavior: 'deny', message: 'User denied permission', toolUseID: options.toolUseID }
            }
        }
      })

      this.logger.info(`[ClaudeSDK] Session created. (ID available after first interaction)`)
      
    } catch (error) {
      this.logger.error('[ClaudeSDK] Failed to initialize session:', error)
      throw error
    }
  }

  async sendMessage(message: string, context: RequestContext): Promise<string> {
    if (!this.session) {
      throw new Error('Claude SDK session not initialized')
    }

    return await this.mutex.runExclusive(async () => {
        // Set context for this transaction
        this.currentContext = context
        
        try {
            await this.session!.send(message)

            let fullResponse = ''
            // Stream the response
            for await (const msg of this.session!.stream()) {
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
            return fullResponse
        } catch (err) {
            this.logger.error('[ClaudeSDK] Error streaming response:', err)
            throw err
        } finally {
            // Clear context
            this.currentContext = null
        }
    })
  }

  async stop() {
    if (this.session) {
      this.session.close()
      this.session = null
      this.logger.info('[ClaudeSDK] Session closed')
    }
  }
}
