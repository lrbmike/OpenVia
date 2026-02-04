
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

  constructor(appId: string, appSecret: string, wsEndpoint?: string) {
    this.appId = appId
    this.appSecret = appSecret
    this.wsEndpoint = wsEndpoint
    
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      // Logger: logger, // Adapter logger if needed
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

    // Using the official event dispatcher via WS
    // Note: The SDK's WSClient handles connection and dispatching internally.
    // We register the event dispatcher with the message handler.
    
    // According to typical SDK usage:
    // const wsClient = new lark.WSClient({ appId, appSecret })
    // wsClient.start({ eventDispatcher: ... })
    
    // We need to define types for the data if not exported by SDK
    
    wsClient.start({
        eventDispatcher: new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data) => {
                // chatId not used yet
                // const chatId = data.message.chat_id
                const userId = data.sender.sender_id?.open_id || 'unknown_user_id'
                const messageId = data.message.message_id
                
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

                messageHandler(text, userId, sendReply).catch(error => {
                    logger.error('Error handling message:', error)
                    sendReply('❌ An error occurred while processing your request.')
                })
            }
        })
    })
  }

  async stop(): Promise<void> {
    // SDK doesn't always expose clean stop for WS, but we can try
    logger.info('Stopping Feishu bot...')
  }
}
