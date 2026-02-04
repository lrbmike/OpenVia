
import * as lark from '@larksuiteoapi/node-sdk'
import { Channel } from './types'
import { Logger } from '../utils/logger'
import { isUserAllowed, logAudit } from '../orchestrator/policy'

const logger = new Logger('FeishuChannel')

export class FeishuChannel implements Channel {
  public id = 'feishu'
  private client: lark.Client
  private appId: string
  private appSecret: string
  private wsEndpoint?: string
  private processedMessages = new Set<string>()

  constructor(appId: string, appSecret: string, wsEndpoint?: string) {
    this.appId = appId
    this.appSecret = appSecret
    this.wsEndpoint = wsEndpoint
    
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
    })
    if (this.wsEndpoint) {
        logger.debug(`Using custom WS Endpoint: ${this.wsEndpoint}`)
    }
  }

  async start(
    messageHandler: (input: string, userId: string, sendReply: (text: string) => Promise<void>) => Promise<void>
  ): Promise<void> {
    logger.info('Starting Feishu bot...')

    const wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
    })

    const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
            const messageId = data.message.message_id
            
            // Deduplication
            if (this.processedMessages.has(messageId)) {
                logger.debug(`Duplicate message detected: ${messageId}, skipping.`)
                return
            }
            this.processedMessages.add(messageId)
            
            // Keep set size manageable
            if (this.processedMessages.size > 1000) {
                const firstId = this.processedMessages.values().next().value
                if (firstId) this.processedMessages.delete(firstId)
            }

            const userId = data.sender.sender_id?.open_id || 'unknown_user_id'
            
            let content: any;
            try {
                content = JSON.parse(data.message.content);
            } catch (e) {
                logger.error('Failed to parse message content', e);
                return;
            }
            
            const text = content.text
            
            logger.info(`Received from ${userId}: ${text}`)

            if (!isUserAllowed(userId)) {
                await this.client.im.message.reply({
                    path: { message_id: messageId },
                    data: {
                        content: JSON.stringify({ text: "⛔ Sorry, you don't have permission to use this Bot." }),
                        msg_type: 'text'
                    }
                })
                logger.warn(`Unauthorized access attempt from ${userId}`)
                return
            }

            logAudit({ userId, action: 'message', result: 'allowed' })

            // Helper to reply
            const sendReply = async (replyText: string) => {
                await this.client.im.message.reply({
                    path: { message_id: messageId },
                    data: {
                        content: JSON.stringify({ text: replyText }),
                        msg_type: 'text'
                    }
                })
            }

            // Notice: We don't await messageHandler here to return to Feishu quickly
            messageHandler(text, userId, sendReply).catch(error => {
                logger.error('Error handling message:', error)
                sendReply('❌ An error occurred while processing your request.')
            })
        }
    })

    wsClient.start({ eventDispatcher })
  }

  async stop(): Promise<void> {
    logger.info('Stopping Feishu bot...')
  }
}
