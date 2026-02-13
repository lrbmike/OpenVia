import * as lark from '@larksuiteoapi/node-sdk'
import { Channel } from './types'
import { Logger } from '../utils/logger'
import { logAudit } from '../orchestrator/policy'
import { PermissionBridge, PendingRequest } from '../utils/permission-bridge'
import type { ContentBlock } from '../types/protocol'

const logger = new Logger('FeishuChannel')

/**
 * Convert standard Markdown to Lark Markdown (lark_md)
 * Lark MD supports: **bold**, *italic*, ~~strikethrough~~, [link](url), and code blocks.
 * It does NOT support headers (#), so we convert them to bold.
 */
function formatLarkMarkdown(markdown: string): string {
    let text = markdown;

    // 1. Headers: # Header -> **Header**
    text = text.replace(/^(#{1,6})\s+(.*)$/gm, '**$2**');

    // 2. Images: ![alt](url) -> [Image: alt](url)
    // Lark cards cannot render arbitrary external image URLs inline easily without uploading.
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[Image: $1]($2)');

    // 3. Lists: Ensure newline before list if not present (Lark is picky?)
    // Actually Lark MD handles lists okay, but sometimes likes \n
    
    return text;
}

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
    messageHandler: (input: string | ContentBlock[], userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>
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
            
            let text = ''
            let imageContent: ContentBlock | null = null

            // Handle Text
            // @ts-ignore - Check both possible property names
            const msgType = data.message.msg_type || data.message.message_type
            
            if (msgType === 'text') {
                 text = content.text
            } 
            // Handle Image
            else if (msgType === 'image') {
                 // @ts-ignore
                 const imageKey = content.image_key
                 logger.info(`Received image from ${userId}: ${imageKey}`)
                 
                 try {
                     // Download image
                     // Use messageResource instead of message.resource
                     const response = await this.client.im.messageResource.get({
                         path: { message_id: messageId, file_key: imageKey },
                         params: { type: 'image' }
                     })
                     
                     // Read stream to buffer
                     const chunks: Buffer[] = []
                    // @ts-ignore
                    const stream = response.getReadableStream() 
                     
                     for await (const chunk of stream) {
                         chunks.push(Buffer.from(chunk))
                     }
                     const buffer = Buffer.concat(chunks)
                     const base64 = buffer.toString('base64')
                     
                     text = '[Image Message]'
                     imageContent = {
                         type: 'image',
                         data: base64,
                         mimeType: 'image/jpeg' 
                     }
                 } catch (err) {
                     logger.error(`Failed to download image ${imageKey}`, err)
                     await this.client.im.message.reply({
                        path: { message_id: messageId },
                        data: { content: JSON.stringify({ text: 'Failed to download image.' }), msg_type: 'text' }
                     })
                     return
                 }
            }
            else {
                logger.warn(`[Feishu] Unsupported message type: ${msgType}`)
                return;
            }
            
            logger.info(`Received from ${userId}: ${text}`)

            logAudit({ userId, action: 'message', result: 'allowed' })

            // Helper to reply
            const sendReply = async (replyText: string) => {
                const mkContent = formatLarkMarkdown(replyText)
                
                const card = {
                    config: { wide_screen_mode: true },
                    elements: [
                        {
                            tag: 'div',
                            text: {
                                tag: 'lark_md',
                                content: mkContent
                            }
                        }
                    ]
                }

                try {
                    await this.client.im.message.reply({
                        path: { message_id: messageId },
                        data: {
                            content: JSON.stringify(card),
                            msg_type: 'interactive'
                        }
                    })
                } catch (e) {
                    logger.error('Failed to send interactive card, falling back to text', e)
                    // Fallback to plain text
                    try {
                        await this.client.im.message.reply({
                            path: { message_id: messageId },
                            data: {
                                content: JSON.stringify({ text: replyText }),
                                msg_type: 'text'
                            }
                        })
                    } catch (e2) {
                        logger.error('Failed to send fallback text message', e2)
                    }
                }
            }

            // 1. Intercept Permission Approvals
            // This allows users to reply "ok" instead of clicking buttons
            const pendingRequest = PermissionBridge.getInstance().findRequestByUser(userId)
            if (pendingRequest) {
                const lowerInput = text.trim().toLowerCase()
                
                // Keywords
                const allowKeywords = ['ok', 'confirm', 'yes', 'y', '允许', '同意', '确认', 'allow']
                const denyKeywords = ['no', 'n', 'deny', 'cancel', '拒绝', '取消', '不']

                if (allowKeywords.includes(lowerInput)) {
                    logger.info(`[Feishu] User ${userId} allowed permission via chat`)
                    PermissionBridge.getInstance().resolveRequest(pendingRequest.id, 'allow')
                    await sendReply('Permission granted via chat.')
                    return
                }

                if (denyKeywords.includes(lowerInput)) {
                     logger.info(`[Feishu] User ${userId} denied permission via chat`)
                     PermissionBridge.getInstance().resolveRequest(pendingRequest.id, 'deny')
                     await sendReply('Permission denied via chat.')
                     return
                }
                
                // Deadlock Prevention:
                // If we proceed to messageHandler while Claude is waiting for this permission,
                // it will hit the Mutex lock and wait forever (or timeout).
                // So we MUST return here.
                await sendReply('You have a pending permission request. Please reply "ok" to allow or "no" to deny.')
                return
            }

            // Notice: We don't await messageHandler here to return to Feishu quickly
            // Pass this.id ('feishu') as channelId
            const finalInput = imageContent ? [imageContent] : text
            messageHandler(finalInput, userId, this.id, sendReply).catch(error => {
                logger.error('Error handling message:', error)
                sendReply('An error occurred while processing your request.')
            })
        },
        // Handle Card Action (Button Clicks)
        'card.action.trigger': async (data: any) => {
             const action = data.action
             const operatorId = data.operator.open_id
             logger.info(`[Feishu] Received card action from ${operatorId}: ${JSON.stringify(action)}`)
             
             if (!action.value || !action.value.reqId) {
                 return { toast: { type: 'error', content: 'Invalid action' } }
             }

             const reqId = action.value.reqId
             const decision = action.value.decision // 'allow' or 'deny'
             
             const bridge = PermissionBridge.getInstance()
             if (decision === 'allow') {
                 bridge.resolveRequest(reqId, 'allow')
                 return { toast: { type: 'success', content: 'Allowed' } }
             } else {
                 bridge.resolveRequest(reqId, 'deny')
                  return { toast: { type: 'success', content: 'Denied' } }
             }
        }
    })

    wsClient.start({ eventDispatcher })
  }

  async stop(): Promise<void> {
    logger.info('Stopping Feishu bot...')
  }

  /**
   * Handle Permission Request via Feishu Card
   */
  async handlePermissionRequest(req: PendingRequest): Promise<void> {
     const userId = req.context.userId
     
     // Construct Interactive Card
     // https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
     const cardContent = {
        config: {
          wide_screen_mode: true
        },
        header: {
          title: {
            tag: 'plain_text',
            content: 'Permission Request'
          },
          template: 'orange'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `${req.message}\n\n**Tip**: You can also reply "ok" to allow or "no" to deny.`
            }
          }
        ]
      }

      try {
          // Verify user type, defaulting to open_id. Only send to the requester.
          await this.client.im.message.create({
              params: {
                  receive_id_type: 'open_id' 
              },
              data: {
                  receive_id: userId,
                  msg_type: 'interactive',
                  content: JSON.stringify(cardContent)
              }
          })
          logger.info(`Sent permission card ${req.id} to user ${userId}`)
      } catch (e) {
          logger.error(`Failed to send permission card to ${userId}`, e)
      }
  }
}
