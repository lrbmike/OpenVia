import { Logger } from './logger'
import { v4 as uuidv4 } from 'uuid'
import { getRequestContext, RequestContext } from '../utils/context'

export type PermissionDecision = 'allow' | 'deny'

export interface PendingRequest {
  id: string
  message: string
  context: RequestContext
  resolve: (decision: PermissionDecision) => void
}

export class PermissionBridge {
  private static instance: PermissionBridge
  private logger = new Logger('PermissionBridge')
  private handler: ((req: PendingRequest) => Promise<void>) | null = null
  private pendingRequests = new Map<string, PendingRequest>()

  private constructor() {}

  static getInstance(): PermissionBridge {
    if (!PermissionBridge.instance) {
      PermissionBridge.instance = new PermissionBridge()
    }
    return PermissionBridge.instance
  }

  /**
   * Register the UI handler (e.g., BotManager)
   */
  registerHandler(handler: (req: PendingRequest) => Promise<void>) {
    this.handler = handler
    this.logger.info('Handler registered')
  }

  /**
   * Request permission from the user
   * Returns a promise that resolves to 'allow' or 'deny'
   */
  async request(message: string): Promise<PermissionDecision> {
    const context = getRequestContext()

    if (!context) {
      this.logger.error('No request context found. Cannot request permission.')
      return 'deny'
    }

    if (!this.handler) {
      this.logger.warn('No handler registered, defaulting to DENY')
      return 'deny'
    }

    return new Promise<PermissionDecision>((resolve) => {
      const id = uuidv4()
      const request: PendingRequest = {
        id,
        message,
        context,
        resolve: (decision) => {
          this.pendingRequests.delete(id)
          resolve(decision)
        }
      }

      this.pendingRequests.set(id, request)
      
      // Notify the handler
      this.handler!(request).catch(err => {
        this.logger.error('Error in permission handler:', err)
        // If handler fails, we should probably deny to avoid hanging
        request.resolve('deny')
      })
    })
  }

  /**
   * Resolve a pending request
   */
  resolveRequest(id: string, decision: PermissionDecision) {
    const request = this.pendingRequests.get(id)
    if (request) {
      this.logger.info(`Resolving request ${id} with ${decision}`)
      request.resolve(decision)
    } else {
      this.logger.warn(`Request ${id} not found or already resolved`)
    }
  }
}
