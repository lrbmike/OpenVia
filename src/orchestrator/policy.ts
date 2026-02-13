/**
 * Permission Control
 */

import { Logger } from '../utils/logger'

const logger = new Logger('Policy')

/** Audit Log Entry */
interface AuditEntry {
  timestamp: number
  userId: string
  action: string
  skill?: string
  args?: unknown
  result: 'allowed' | 'denied'
  reason?: string
}

/** Audit Log (In-memory storage, should be persisted in production) */
const auditLog: AuditEntry[] = []

/** Maximum number of audit log entries */
const MAX_AUDIT_ENTRIES = 1000

/** Allowed user IDs cache (by channel) */
let allowedUsersByChannelInternal: Record<string, string[]> = {}

/** Log once per channel to avoid flooding */
const noWhitelistWarnedChannels = new Set<string>()

interface PolicyChannelConfig {
  telegram?: Array<number | string>
  feishu?: Array<number | string>
}

function normalizeAllowedIds(ids?: Array<number | string>): string[] {
  if (!ids || ids.length === 0) return []
  return ids
    .map((id) => String(id).trim())
    .filter((id) => id.length > 0)
}

/**
 * Initialize Policy Module
 */
export function initPolicy(allowedIds: PolicyChannelConfig | number[]): void {
  noWhitelistWarnedChannels.clear()

  // Backward compatibility: old single-list init means telegram whitelist
  if (Array.isArray(allowedIds)) {
    allowedUsersByChannelInternal = {
      telegram: normalizeAllowedIds(allowedIds)
    }
    return
  }

  allowedUsersByChannelInternal = {
    telegram: normalizeAllowedIds(allowedIds.telegram),
    feishu: normalizeAllowedIds(allowedIds.feishu)
  }
}

/**
 * Get allowed users list
 */
export function getAllowedUsers(channelId = 'telegram'): string[] {
  return allowedUsersByChannelInternal[channelId] || []
}

/**
 * Check if user is allowed
 */
export function isUserAllowed(userId: string, channelId = 'telegram'): boolean {
  const allowedUsers = getAllowedUsers(channelId)

  // If no whitelist is configured, allow all users (Development mode)
  if (allowedUsers.length === 0) {
    if (!noWhitelistWarnedChannels.has(channelId)) {
      noWhitelistWarnedChannels.add(channelId)
      logger.warn(`[Policy] No whitelist configured for channel "${channelId}", allowing all users`)
    }
    return true
  }

  return allowedUsers.includes(String(userId).trim())
}

/**
 * Check if skill execution is allowed
 */
export function isSkillAllowed(userId: string, _skillName: string): boolean {
  // MVP: All skills are available to authorized users
  // Can be extended to per-user skill whitelisting in the future
  return isUserAllowed(userId)
}

/**
 * Record Audit Log
 */
export function logAudit(entry: Omit<AuditEntry, 'timestamp'>): void {
  const fullEntry: AuditEntry = {
    ...entry,
    timestamp: Date.now(),
  }

  auditLog.push(fullEntry)

  // Truncate if too long
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES)
  }

  // Console output
  const status = entry.result === 'allowed' ? 'ALLOW' : 'DENY'
  logger.info(
    `[Audit] ${status} User:${entry.userId} Action:${entry.action}${entry.skill ? ` Skill:${entry.skill}` : ''}${
      entry.reason ? ` (${entry.reason})` : ''
    }`
  )
}

/**
 * Get Audit Logs
 */
export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit)
}

