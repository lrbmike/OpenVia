/**
 * Permission Control
 */

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

/** Allowed user IDs cache */
let allowedUsersInternal: string[] = []

/**
 * Initialize Policy Module
 */
export function initPolicy(allowedIds: number[]): void {
  allowedUsersInternal = allowedIds.map(String)
}

/**
 * Get allowed users list
 */
export function getAllowedUsers(): string[] {
  // 1. Priority: Internal cache (from config.json)
  if (allowedUsersInternal.length > 0) {
    return allowedUsersInternal
  }

  // 2. Fallback: Environment variable
  const users = process.env.ALLOWED_USER_IDS || ''
  return users.split(',').map((id) => id.trim()).filter((id) => id.length > 0)
}

/**
 * Check if user is allowed
 */
export function isUserAllowed(userId: string): boolean {
  const allowedUsers = getAllowedUsers()

  // If no whitelist is configured, allow all users (Development mode)
  if (allowedUsers.length === 0) {
    console.warn('[Policy] No ALLOWED_USER_IDS configured, allowing all users')
    return true
  }

  return allowedUsers.includes(userId)
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
  const status = entry.result === 'allowed' ? '✓' : '✗'
  console.log(
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
