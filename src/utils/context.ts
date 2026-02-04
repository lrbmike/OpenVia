import { AsyncLocalStorage } from 'async_hooks'

export interface RequestContext {
  userId: string
  channelId: string
  sendReply: (text: string) => Promise<void>
}

const contextStorage = new AsyncLocalStorage<RequestContext>()

/**
 * Run a function within a request context
 */
export function runWithContext<T>(context: RequestContext, callback: () => T): T {
  return contextStorage.run(context, callback)
}

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return contextStorage.getStore()
}
