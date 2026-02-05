/**
 * Claude Session Manager
 * 
 * 管理多用户的 Claude SDK Session，实现会话隔离。
 * 每个用户拥有独立的 Session，互不干扰。
 */

import { ClaudeSDKClient } from './claude-sdk'
import { Logger } from '../utils/logger'
import type { AppConfig } from '../config'

const logger = new Logger('SessionManager')

/** Session 超时时间（30 分钟） */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** Session 条目 */
interface SessionEntry {
  client: ClaudeSDKClient
  lastActivity: number
}

export class ClaudeSessionManager {
  private sessions: Map<string, SessionEntry> = new Map()
  private config: AppConfig['claude']
  private workDir?: string
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: AppConfig['claude'], workDir?: string) {
    this.config = config
    this.workDir = workDir
    
    // 启动定时清理任务（每 5 分钟检查一次）
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions()
    }, 5 * 60 * 1000)
    
    logger.info('[SessionManager] Initialized with auto-cleanup enabled.')
  }

  /**
   * 获取或创建用户专属的 Session
   */
  async getOrCreateSession(userId: string): Promise<ClaudeSDKClient> {
    let entry = this.sessions.get(userId)

    if (entry) {
      // 更新活动时间
      entry.lastActivity = Date.now()
      logger.debug(`[SessionManager] Reusing existing session for user: ${userId}`)
      return entry.client
    }

    // 创建新 Session
    logger.info(`[SessionManager] Creating new session for user: ${userId}`)
    const client = new ClaudeSDKClient()
    // 传递 workDir (sessions 目录)
    await client.initialize(this.config, this.workDir)

    entry = {
      client,
      lastActivity: Date.now()
    }
    this.sessions.set(userId, entry)

    logger.info(`[SessionManager] Session created. Total active sessions: ${this.sessions.size}`)
    return client
  }

  /**
   * 销毁指定用户的 Session
   */
  async destroySession(userId: string): Promise<boolean> {
    const entry = this.sessions.get(userId)
    if (!entry) {
      return false
    }

    await entry.client.stop()
    this.sessions.delete(userId)
    logger.info(`[SessionManager] Destroyed session for user: ${userId}`)
    return true
  }

  /**
   * 清理不活跃的 Session
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [userId, entry] of this.sessions.entries()) {
      if (now - entry.lastActivity > SESSION_TIMEOUT_MS) {
        entry.client.stop().catch(err => {
          logger.error(`[SessionManager] Error stopping session for ${userId}:`, err)
        })
        this.sessions.delete(userId)
        cleaned++
        logger.info(`[SessionManager] Cleaned up inactive session: ${userId}`)
      }
    }

    if (cleaned > 0) {
      logger.info(`[SessionManager] Cleanup complete. Removed ${cleaned} sessions. Active: ${this.sessions.size}`)
    }
  }

  /**
   * 获取当前活跃的 Session 数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size
  }

  /**
   * 停止所有 Session 并清理资源
   */
  async stopAll(): Promise<void> {
    logger.info(`[SessionManager] Stopping all ${this.sessions.size} sessions...`)

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    const stopPromises = Array.from(this.sessions.values()).map(entry =>
      entry.client.stop().catch(err => {
        logger.error('[SessionManager] Error stopping session:', err)
      })
    )

    await Promise.all(stopPromises)
    this.sessions.clear()

    logger.info('[SessionManager] All sessions stopped.')
  }
}
