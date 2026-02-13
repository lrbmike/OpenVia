/**
 * Session Management
 */

import type { Message } from '../types'
import { Logger } from '../utils/logger'

const logger = new Logger('Session')

/** Session Data */
interface Session {
  userId: string
  chatId: string
  history: Message[]
  lastActivity: number
}

/** Session Storage (In-memory) */
const sessions: Map<string, Session> = new Map()

/** Maximum number of history messages */
const MAX_HISTORY = 20

/** Session timeout (30 minutes) */
const SESSION_TIMEOUT = 30 * 60 * 1000

/**
 * Get Session Key
 */
function getSessionKey(userId: string, chatId: string): string {
  return `${userId}:${chatId}`
}

/**
 * Get or Create Session
 */
export function getSession(userId: string, chatId: string): Session {
  const key = getSessionKey(userId, chatId)
  let session = sessions.get(key)

  if (!session) {
    session = {
      userId,
      chatId,
      history: [],
      lastActivity: Date.now(),
    }
    sessions.set(key, session)
  }

  session.lastActivity = Date.now()
  return session
}

/**
 * Add message to history
 */
export function addMessage(userId: string, chatId: string, message: Message): void {
  const session = getSession(userId, chatId)
  session.history.push(message)

  // Truncate history if too long
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY)
  }
}

/**
 * Get conversation history
 */
export function getHistory(userId: string, chatId: string): Message[] {
  return getSession(userId, chatId).history
}

/**
 * Clear session
 */
export function clearSession(userId: string, chatId: string): void {
  const key = getSessionKey(userId, chatId)
  sessions.delete(key)
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now()
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(key)
      logger.info(`[Session] Cleaned up expired session: ${key}`)
    }
  }
}

// Periodically clean up expired sessions (every 5 minutes)
setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

