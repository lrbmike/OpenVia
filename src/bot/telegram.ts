/**
 * Telegram Bot Communication Layer
 */
import { Bot, Context, GrammyError, HttpError } from 'grammy'
import { isUserAllowed, logAudit } from '../orchestrator/policy'
import { Logger } from '../utils/logger'
import { Channel } from './types'
import { PermissionBridge, PendingRequest } from '../utils/permission-bridge'
import { InlineKeyboard } from 'grammy'

const logger = new Logger('TelegramChannel')
const MAX_MESSAGE_LENGTH = 4000

export class TelegramChannel implements Channel {
  public id = 'telegram'
  private bot: Bot | null = null
  private token: string

  constructor(token: string) {
    this.token = token
  }

  async start(
    messageHandler: (input: string, userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>
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
          await ctx.answerCallbackQuery({ text: 'Allowed ✅' })
          await ctx.editMessageText(`${ctx.callbackQuery.message?.text}\n\n(Allowed by ${ctx.from.first_name})`, { parse_mode: 'Markdown' })
      } else {
          bridge.resolveRequest(id, 'deny')
          await ctx.answerCallbackQuery({ text: 'Denied ❌' })
           await ctx.editMessageText(`${ctx.callbackQuery.message?.text}\n\n(Denied by ${ctx.from.first_name})`, { parse_mode: 'Markdown' })
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
        `👋 Welcome to OpenVia!\n\nSend /help to see how to use me.`
      )
    })
    
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        `📖 Help
        
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
      
      await ctx.reply('✅ Conversation history cleared')
    })

    // Message handling
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from.id.toString()
      const text = ctx.message.text
      const username = ctx.from.username || ctx.from.first_name || 'Unknown'

      logger.info(`Received from ${username} (${userId}): ${text.slice(0, 50)}${text.length > 50 ? '...' : ''}`)

      if (!isUserAllowed(userId)) {
        await ctx.reply("⛔ Sorry, you don't have permission to use this Bot.")
        logger.warn(`Unauthorized access attempt from ${userId}`)
        return
      }

      // Audit log
      logAudit({ userId, action: 'message', result: 'allowed' })

      // Show typing status
      await ctx.replyWithChatAction('typing')

      // Handle message asynchronously
      // Pass this.id ('telegram') as channelId
      messageHandler(text, userId, this.id, async (replyText) => {
        await this.sendLongMessage(ctx, replyText)
      }).catch((error) => {
        logger.error('Error handling message:', error)
        ctx.reply('❌ An error occurred while processing your request. Please try again later.').catch(e => logger.error('Failed to send error reply', e))
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
          .text('✅ Allow', `perm:allow:${req.id}`)
          .text('❌ Deny', `perm:deny:${req.id}`)

      try {
          await this.bot.api.sendMessage(userId, req.message, {
              parse_mode: 'Markdown',
              reply_markup: keyboard
          })
          logger.info(`Sent permission request ${req.id} to user ${userId}`)
      } catch (e) {
          logger.error(`Failed to send permission request to ${userId}`, e)
      }
  }

  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    logger.info(`Sending reply to ${ctx.chat?.id}: ${text.slice(0, 50)}...${text.length > 50 ? ` (total: ${text.length})` : ''}`)
    
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await ctx.reply(text)
      return
    }

    // Split message
    const parts: string[] = []
    let current = ''
    
    const lines = text.split('\n')
    
    for (const line of lines) {
      if (current.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
        parts.push(current)
        current = line
      } else {
        current = current ? current + '\n' + line : line
      }
    }
    if (current) parts.push(current)
    
    logger.debug(`Message too long, split into ${parts.length} parts`)
    
    for (const part of parts) {
      await ctx.reply(part)
    }
  }
}
