import { Channel } from './types'
import { Logger } from '../utils/logger'
import { AppConfig } from '../config'
import { TelegramChannel } from './telegram'
import { FeishuChannel } from './feishu'
import { PermissionBridge } from '../utils/permission-bridge'

const logger = new Logger('BotManager')

export class BotManager {
  private channels: Channel[] = []
  private messageHandler: (input: string, userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>

  constructor(
      messageHandler: (input: string, userId: string, channelId: string, sendReply: (text: string) => Promise<void>) => Promise<void>
  ) {
    this.messageHandler = messageHandler
  }

  public registerChannel(channel: Channel) {
    this.channels.push(channel)
  }

  public async startAll(config: AppConfig) {
      // Register Permission Handler
      PermissionBridge.getInstance().registerHandler(async (req) => {
          const targetChannelId = req.context.channelId
          const channel = this.channels.find(c => c.id === targetChannelId)
          
          if (channel && channel.handlePermissionRequest) {
              logger.info(`Dispatching permission request ${req.id} to channel ${targetChannelId}`)
              await channel.handlePermissionRequest(req)
          } else {
              logger.warn(`Target channel ${targetChannelId} not found or does not support permissions`)
          }
      })

      const activeAdapter = config.adapters.default || 'telegram'
      logger.info(`Starting active adapter: ${activeAdapter}`)

      // 1. Telegram
      if (activeAdapter === 'telegram' && config.adapters.telegram?.botToken) {
          const telegram = new TelegramChannel(config.adapters.telegram.botToken)
          this.registerChannel(telegram)
      }

      // 2. Feishu
      else if (activeAdapter === 'feishu' && config.adapters.feishu?.appId && config.adapters.feishu?.appSecret) {
          const feishu = new FeishuChannel(
              config.adapters.feishu.appId,
              config.adapters.feishu.appSecret,
              config.adapters.feishu.wsEndpoint
          )
          this.registerChannel(feishu)
      }

      if (this.channels.length === 0) {
          logger.warn('No channels configured.')
          return
      }

      for (const channel of this.channels) {
          try {
              logger.info(`Starting channel: ${channel.id}`)
              await channel.start(this.messageHandler)
          } catch (error) {
              logger.error(`Failed to start channel ${channel.id}:`, error)
          }
      }
  }

  public async stopAll() {
      for (const channel of this.channels) {
          try {
              await channel.stop()
          } catch (error) {
              logger.error(`Failed to stop channel ${channel.id}:`, error)
          }
      }
      this.channels = []
  }
}
