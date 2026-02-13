/**
 * Telegram Bot Communication Layer
 */
import { Bot, Context, GrammyError, HttpError } from 'grammy'
import { isUserAllowed, logAudit } from '../orchestrator/policy'
import { Logger } from '../utils/logger'
import { Channel } from './types'
import { PermissionBridge, PendingRequest } from '../utils/permission-bridge'
import { InlineKeyboard } from 'grammy'
import type { ContentBlock } from '../types/protocol'

const logger = new Logger('TelegramChannel')
const MAX_MESSAGE_LENGTH = 4000

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Robust Markdown to HTML converter for Telegram
 * Supports: code blocks, inline code, bold, italic, links, headers, lists
 */
function formatMarkdownToHtml(markdown: string): string {
  const placeholders: string[] = []
  
  // 1. Protect Code Blocks (triple backticks)
  // We use a placeholder to prevent internal markdown from being processed
  let text = markdown.replace(/```(?:(\w+)\n)?([\s\S]*?)```/g, (_, lang, code) => {
    const i = placeholders.length
    // Telegram supports <pre><code class="language-xyz">...</code></pre>
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
    placeholders.push(`<pre><code${langAttr}>${escapeHtml(code)}</code></pre>`)
    return `__CODE_BLOCK_${i}__`
  })

  // 2. Protect Inline Code (single backticks)
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const i = placeholders.length
    placeholders.push(`<code>${escapeHtml(code)}</code>`)
    return `__CODE_INLINE_${i}__`
  })

  // 3. Escape HTML for the Rest (Crucial step!)
  // Now that code is protected, we must escape all other text to avoid injection
  // or confusion with our own tags.
  text = escapeHtml(text)

  // 4. Process Markdown Elements
  
  // Headers: # H1 -> <b>H1</b>, ## H2 -> <b>H2</b>
  // (Telegram only supports b, i, u, s, etc., no h1-h6, so we map to bold)
  text = text.replace(/^(#{1,6})\s+(.*)$/gm, '<b>$2</b>')

  // Bold: **text** or __text__ -> <b>text</b>
  text = text.replace(/(\*\*|__)(.*?)\1/g, '<b>$2</b>')

  // Italic: *text* or _text_ -> <i>text</i>
  // Note: This regex is simple and might catch internal underscores in words if not careful.
  // But for standard LLM markdown it usually works well.
  // Using a negative lookbehind/lookahead can help strictly, but simple is often robust enough for chat.
  text = text.replace(/(\*|_)(.*?)\1/g, '<i>$2</i>')

  // Links: [text](url) -> <a href="url">text</a>
  // We already escaped HTML, so the URL might have &amp; inside.
  // But standard markdown link structure usually is [text](url).
  // The regex needs to handle the escaped brackets if they were escaped?
  // Actually, we escaped < > & but not [ ] ( ).
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Lists: 
  // - item -> • item
  // * item -> • item
  text = text.replace(/^(\s*)[-*]\s+(.*)$/gm, '$1• $2')

  // 5. Restore Placeholders
  placeholders.forEach((val, i) => {
    // We must replace strictly.
    // Since we escaped the text in step 3, our placeholders __CODE_...__ might have been escaped?
    // No, underscores are not escaped by escapeHtml.
    text = text.replace(`__CODE_BLOCK_${i}__`, val)
    text = text.replace(`__CODE_INLINE_${i}__`, val)
  })

  return text
}

export class TelegramChannel implements Channel {
  public id = 'telegram'
  private bot: Bot | null = null
  private token: string

  constructor(token: string) {
    this.token = token
  }

  async start(
    messageHandler: (input: string | ContentBlock[], userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>
  ): Promise<void> {
    if (!this.token) {
      throw new Error('Telegram bot token not provided')
    }

    logger.info('Starting Telegram bot...')
    this.bot = new Bot(this.token)

    // 1. Register Permission Handler - REMOVED (Handled by BotManager now)

    // 2. Handle Callback Queries (Button Clicks)
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data
      logger.info(`[Telegram] Received callback: ${data}`)
      
      if (!data.startsWith('perm:')) return

      const parts = data.split(':')
      const action = parts[1]
      const id = parts[2]
      
      logger.info(`[Telegram] Processing permission: action=${action}, id=${id}`)
      const bridge = PermissionBridge.getInstance()
      
      if (action === 'allow') {
          bridge.resolveRequest(id, 'allow')
          await ctx.answerCallbackQuery({ text: 'Allowed' })
          
          const originalText = ctx.callbackQuery.message?.text || ''
          const htmlText = formatMarkdownToHtml(originalText)
          try {
              await ctx.editMessageText(`${htmlText}\n\n<b>(Allowed by ${escapeHtml(ctx.from.first_name)})</b>`, { parse_mode: 'HTML' })
          } catch (e) {
               // Fallback if edit fails
               await ctx.editMessageText(`${originalText}\n\n(Allowed by ${ctx.from.first_name})`)
          }
      } else {
          bridge.resolveRequest(id, 'deny')
          await ctx.answerCallbackQuery({ text: 'Denied' })
          
          const originalText = ctx.callbackQuery.message?.text || ''
          const htmlText = formatMarkdownToHtml(originalText)
          try {
             await ctx.editMessageText(`${htmlText}\n\n<b>(Denied by ${escapeHtml(ctx.from.first_name)})</b>`, { parse_mode: 'HTML' })
          } catch (e) {
             await ctx.editMessageText(`${originalText}\n\n(Denied by ${ctx.from.first_name})`)
          }
      }
    })

    // Error handling
    this.bot.catch((err) => {
        const ctx = err.ctx as Context
        const e = err.error
        logger.error(`Error while handling update ${ctx.update.update_id}:`)
        
        if (e instanceof GrammyError) {
            logger.error('Error in request:', e.description)
        } else if (e instanceof HttpError) {
            logger.error('Could not contact Telegram:', e)
        } else {
            logger.error('Unknown error:', e)
        }
    })

    // Command handlers
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        `Welcome to OpenVia!\n\nSend /help to see how to use me.`
      )
    })
    
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        `Help
        
  Send me a message in natural language, and I'll understand and execute!
  For example:
  - "Read files in the current directory"
  - "Check git status"
  - "Analyze README.md"
  
  Commands:
  /clear - Clear conversation history
  `,
        { parse_mode: 'Markdown' }
      )
    })

    this.bot.command('clear', async (ctx) => {
      // Dynamic import to avoid circular dependency
      const { getSession } = await import('../orchestrator/session')
      const userId = String(ctx.from?.id || '')
      const chatId = String(ctx.chat?.id || userId)
      const session = getSession(userId, chatId)
      session.history = []
      
      await ctx.reply('Conversation history cleared')
    })

    // Message handling
    this.bot.on(['message:text', 'message:photo'], async (ctx) => {
      const userId = ctx.from.id.toString()
      
      let text = ''
      let contentBlocks: ContentBlock[] | null = null

      if (ctx.message.text) {
          text = ctx.message.text
      } else if (ctx.message.photo) {
          const photo = ctx.message.photo.pop() // Get largest
          if (photo) {
             try {
                 logger.info(`Received photo from ${userId}`)
                 const file = await ctx.api.getFile(photo.file_id)
                 if (file.file_path) {
                     const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`
                     const resp = await fetch(url)
                     const arrayBuffer = await resp.arrayBuffer()
                     const base64 = Buffer.from(arrayBuffer).toString('base64')
                     
                     const caption = ctx.message.caption || ''
                     text = caption || '[Image Message]'
                     
                     contentBlocks = []
                     if (caption) {
                         contentBlocks.push({ type: 'text', text: caption })
                     }
                     contentBlocks.push({
                         type: 'image',
                         data: base64,
                         mimeType: 'image/jpeg' 
                     })
                 }
             } catch (e) {
                 logger.error('Failed to download photo', e)
                 await ctx.reply('Failed to process image.')
                 return
             }
          }
      }
      const username = ctx.from.username || ctx.from.first_name || 'Unknown'

      logger.info(`Received from ${username} (${userId}): ${text.slice(0, 50)}${text.length > 50 ? '...' : ''}`)

      if (!isUserAllowed(userId, this.id)) {
        await ctx.reply("Sorry, you don't have permission to use this Bot.")
        logger.warn(`Unauthorized access attempt from ${userId}`)
        return
      }

      // Audit log
      logAudit({ userId, action: 'message', result: 'allowed' })

      // Show typing status
      await ctx.replyWithChatAction('typing')

      // Handle message asynchronously
      // Pass this.id ('telegram') as channelId
      const input = contentBlocks ? contentBlocks : text
      messageHandler(input, userId, this.id, async (replyText) => {
        await this.sendLongMessage(ctx, replyText)
      }).catch((error) => {
        logger.error('Error handling message:', error)
        ctx.reply('An error occurred while processing your request. Please try again later.').catch(e => logger.error('Failed to send error reply', e))
      })
    })

    // Start
    await this.bot.start({
        allowed_updates: ['message', 'callback_query'],
        onStart: (botInfo) => {
            logger.info(`Bot started: @${botInfo.username}`)
        },
    })
  }

  async stop(): Promise<void> {
    logger.info('Stopping bot...')
    if (this.bot) {
      await this.bot.stop()
      this.bot = null
    }
  }

  /**
   * Handle Permission Request (Called by BotManager)
   */
  async handlePermissionRequest(req: PendingRequest): Promise<void> {
      if (!this.bot) {
          logger.error('Cannot handle permission request: Bot not initialized')
          return
      }

      // ONLY send to the user who initiated the request
      const userId = req.context.userId
      
      const keyboard = new InlineKeyboard()
          .text('Allow', `perm:allow:${req.id}`)
          .text('Deny', `perm:deny:${req.id}`)

      try {
          const htmlMessage = formatMarkdownToHtml(req.message)
          await this.bot.api.sendMessage(userId, htmlMessage, {
              parse_mode: 'HTML',
              reply_markup: keyboard
          })
          logger.info(`Sent permission request ${req.id} to user ${userId}`)
      } catch (e) {
          logger.error(`Failed to send permission request to ${userId}`, e)
          // Fallback to plain text if HTML fails
          try {
             await this.bot.api.sendMessage(userId, `Permission Request:\n${req.message}`, {
                 reply_markup: keyboard
             })
          } catch (e2) {
             logger.error(`Failed to send fallback permission request to ${userId}`, e2)
          }
      }
  }

  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    logger.info(`Sending reply to ${ctx.chat?.id}: ${text.slice(0, 50)}...${text.length > 50 ? ` (total: ${text.length})` : ''}`)
    
    // We try to send with HTML parsing enabled
    const sendOptions = { parse_mode: 'HTML' } as const

    const sendMessageSafely = async (content: string) => {
        try {
            const html = formatMarkdownToHtml(content)
            
            if (html.length <= MAX_MESSAGE_LENGTH) {
                await ctx.reply(html, sendOptions)
            } else {
                 // Split splitting is complex with HTML tags. 
                 // Simple approach: Split raw text and format each part.
                 // This might break code blocks across messages, but it's safer than splitting HTML.
                 // Actually, splitting formatted HTML is hard.
                 // Let's split the RAW markdown validation.
                 
                const lines = content.split('\n')
                let current = ''
                
                for (const line of lines) {
                    if (current.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
                        await ctx.reply(formatMarkdownToHtml(current), sendOptions)
                        current = line
                    } else {
                        current = current ? current + '\n' + line : line
                    }
                }
                if (current) await ctx.reply(formatMarkdownToHtml(current), sendOptions)
            }
        } catch (e) {
            logger.warn('Failed to send HTML message, falling back to plain text:', e)
            try {
                // FALLBACK: Send raw text
                if (content.length <= MAX_MESSAGE_LENGTH) {
                    await ctx.reply(content)
                } else {
                    const lines = content.split('\n')
                    let current = ''
                    for (const line of lines) {
                        if (current.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
                            await ctx.reply(current)
                            current = line
                        } else {
                            current = current ? current + '\n' + line : line
                        }
                    }
                    if (current) await ctx.reply(current)
                }
            } catch (e2) {
                 logger.error('Failed to send fallback message', e2)
            }
        }
    }

    await sendMessageSafely(text)
  }
}
