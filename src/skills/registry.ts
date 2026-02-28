import { Database } from 'bun:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Logger } from '../utils/logger'

const logger = new Logger('CapabilityRegistry')

/** 全局单例 DB 实例 */
let db: Database | null = null

export type SkillScope = 'core' | 'task' | 'persistent'
export type ExperienceScopeType = 'global' | 'user'

export interface ExperienceRule {
  id: number
  scopeType: ExperienceScopeType
  scopeId: string
  scene: string
  pattern: string
  instruction: string
  priority: number
  confidence: number
  enabled: boolean
  source: string
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  hitCount: number
  effectiveCount: number
  ineffectiveCount: number
  effectiveStreak: number
  lastHitAt: number | null
  lastEffectiveAt: number | null
}

export interface UpsertExperienceRuleInput {
  scopeType?: ExperienceScopeType
  scopeId?: string
  scene?: string
  pattern?: string
  instruction: string
  priority?: number
  confidence?: number
  enabled?: boolean
  source?: string
  expiresAt?: number | null
}

export interface ExperienceRuleQuery {
  userId?: string
  scene?: string
  goalText?: string
  limit?: number
}

export interface ExperienceEventInput {
  ruleId?: number | null
  eventType: string
  scene?: string
  signal?: string
  payload?: unknown
  success?: boolean | null
  userId?: string
  goalId?: string
}

export interface AutoPromoteExperienceInput {
  eventType: string
  scene?: string
  signal?: string
  userId?: string
  scopeType?: ExperienceScopeType
  threshold?: number
  windowMinutes?: number
  enabled?: boolean
}

export interface AutoPromoteExperienceResult {
  promoted: boolean
  recentCount: number
  ruleId?: number
  reason?: string
}

export interface ExperienceQueueDrainOptions {
  batchSize?: number
  autoPromoteEnabled?: boolean
  autoPromoteScope?: ExperienceScopeType
  autoPromoteThreshold?: number
  autoPromoteWindowMinutes?: number
  refinePromotedRule?: (input: {
    ruleId: number
    eventType: string
    scene: string
    signal: string
    userId: string
    goalId: string
    instruction: string
    recentCount: number
  }) => Promise<string | null>
}

export interface ExperienceQueueDrainResult {
  claimed: number
  processed: number
  promoted: number
  refined: number
  failed: number
}

export interface ExperienceQueueCleanupOptions {
  retentionHours?: number
  maxRowsPerRun?: number
  staleFailedAttempts?: number
}

export interface ExperienceQueueCleanupResult {
  deletedDone: number
  deletedFailed: number
}

export interface ExperienceRuleHitInput {
  ruleIds: number[]
  userId?: string
  goalId?: string
  scene?: string
  phase?: string
}

export interface ReinforceExperienceRulesInput {
  ruleIds: number[]
  outcome: 'effective' | 'ineffective'
  userId?: string
  goalId?: string
  scene?: string
  reason?: string
  onlyAuto?: boolean
}

const DEFAULT_EXPERIENCE_RULES: UpsertExperienceRuleInput[] = [
  {
    scopeType: 'global',
    scene: 'database',
    pattern: 'postgres,postgresql,mysql,sql,数据库,索引',
    instruction: '数据库类目标若能力不足，先执行 npx skills find/add 并绑定，再继续任务主流程。',
    priority: 90,
    confidence: 0.86,
    source: 'seed',
  },
  {
    scopeType: 'global',
    scene: 'database',
    pattern: 'host,hostname,ip,端口,postgresql://,jdbc:',
    instruction: '已提供远程连接信息时优先远程执行，避免重复探测本地 psql 或本机包管理器。',
    priority: 92,
    confidence: 0.9,
    source: 'seed',
  },
  {
    scopeType: 'global',
    scene: 'general',
    pattern: '*',
    instruction: '当同一工具调用失败或重复被拦截后，必须切换策略，复用已有结果，不要循环重试。',
    priority: 80,
    confidence: 0.84,
    source: 'seed',
  },
  {
    scopeType: 'global',
    scene: 'general',
    pattern: 'stop,enough,足够,结果已够',
    instruction: '如果单次工具结果已足够回答当前步骤，应立即产出结论并停止继续调工具。',
    priority: 78,
    confidence: 0.8,
    source: 'seed',
  },
]

// ============================================================================
// 初始化
// ============================================================================

/**
 * 初始化 Capability Database
 * 默认位置: ~/.openvia/data/capabilities.db
 */
export async function initRegistry(): Promise<void> {
  if (db) return

  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const dataDir = path.join(homeDir, '.openvia', 'data')
  const dbPath = path.join(dataDir, 'capabilities.db')

  // 确保目录存在
  await fs.mkdir(dataDir, { recursive: true }).catch(() => {})

  db = new Database(dbPath)

  // 初始化表结构
  // 1. installed_capabilities: 记录本地已安装的所有技能
  db.run(`
    CREATE TABLE IF NOT EXISTS installed_capabilities (
      skill_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope TEXT DEFAULT 'persistent'
    )
  `)

  // 2. active_contexts: 逻辑映射，记录 goal_id 当前可见的 task-scoped 技能
  db.run(`
    CREATE TABLE IF NOT EXISTS active_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      UNIQUE(goal_id, skill_id)
    )
  `)

  // 3. experience_rules: 经验规则（支持 global / user 作用域）
  db.run(`
    CREATE TABLE IF NOT EXISTS experience_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'user')),
      scope_id TEXT NOT NULL DEFAULT '',
      scene TEXT NOT NULL DEFAULT 'general',
      pattern TEXT NOT NULL DEFAULT '*',
      instruction TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      confidence REAL NOT NULL DEFAULT 0.6,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual',
      hit_count INTEGER NOT NULL DEFAULT 0,
      effective_count INTEGER NOT NULL DEFAULT 0,
      ineffective_count INTEGER NOT NULL DEFAULT 0,
      effective_streak INTEGER NOT NULL DEFAULT 0,
      last_hit_at INTEGER,
      last_effective_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER,
      UNIQUE(scope_type, scope_id, scene, pattern)
    )
  `)

  // 4. experience_events: 经验事件日志
  db.run(`
    CREATE TABLE IF NOT EXISTS experience_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      event_type TEXT NOT NULL,
      scene TEXT NOT NULL DEFAULT 'general',
      signal TEXT NOT NULL DEFAULT '',
      payload_json TEXT,
      success INTEGER,
      user_id TEXT NOT NULL DEFAULT '',
      goal_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(rule_id) REFERENCES experience_rules(id)
    )
  `)

  // 5. experience_processing_queue: 经验事件异步处理队列
  db.run(`
    CREATE TABLE IF NOT EXISTS experience_processing_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      available_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES experience_events(id)
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_active_contexts_goal ON active_contexts(goal_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_rules_scope ON experience_rules(scope_type, scope_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_rules_scene ON experience_rules(scene, enabled, priority DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_events_scene ON experience_events(scene, event_type, created_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_events_user_goal ON experience_events(user_id, goal_id, created_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_rules_effect ON experience_rules(enabled, effective_streak, priority DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_experience_queue_status ON experience_processing_queue(status, available_at, id)`)

  // 兼容旧库：补齐经验规则增强字段
  ensureColumnExists(db, 'experience_rules', 'hit_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumnExists(db, 'experience_rules', 'effective_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumnExists(db, 'experience_rules', 'ineffective_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumnExists(db, 'experience_rules', 'effective_streak', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumnExists(db, 'experience_rules', 'last_hit_at', 'INTEGER')
  ensureColumnExists(db, 'experience_rules', 'last_effective_at', 'INTEGER')

  seedDefaultExperienceRules()

  logger.info(`Capability Registry initialized at ${dbPath}`)
}

/**
 * 获取 DB 实例 (需先 initRegistry)
 */
function getDb(): Database {
  if (!db) {
    throw new Error('CapabilityRegistry not initialized. Call initRegistry() first.')
  }
  return db
}

// ============================================================================
// 注册表写入操作
// ============================================================================

/**
 * 注册刚安装的技能到 SQLite 物理记录表
 */
export function registerInstalledSkill(
  skillId: string,
  name: string,
  description: string,
  scope: SkillScope = 'persistent'
): void {
  const existing = getDb()
    .prepare(`SELECT name, description, scope FROM installed_capabilities WHERE skill_id = ?`)
    .get(skillId) as { name: string; description: string; scope: string } | undefined

  if (
    existing &&
    existing.name === name &&
    (existing.description || '') === (description || '') &&
    existing.scope === scope
  ) {
    return
  }

  const statement = getDb().prepare(
    `INSERT OR REPLACE INTO installed_capabilities (skill_id, name, description, scope) 
     VALUES (?, ?, ?, ?)`
  )
  statement.run(skillId, name, description, scope)
  if (existing) {
    logger.info(`Updated skill metadata: ${skillId} (scope: ${scope})`)
  } else {
    logger.info(`Registered skill: ${skillId} (scope: ${scope})`)
  }
}

/**
 * 将一个 Task-Scoped 技能逻辑绑定到特定的 Goal
 */
export function bindSkillToGoal(skillId: string, goalId: string): void {
  const statement = getDb().prepare(
    `INSERT OR IGNORE INTO active_contexts (goal_id, skill_id) VALUES (?, ?)`
  )
  statement.run(goalId, skillId)
  logger.info(`Bound skill ${skillId} to goal ${goalId}`)
}

/**
 * 释放关联到特定 Goal 的所有任务作用域技能逻辑绑定
 * 注意：不删除物理文件，只清除 active_contexts 表
 */
export function unbindSkillsFromGoal(goalId: string): void {
  const statement = getDb().prepare(
    `DELETE FROM active_contexts WHERE goal_id = ?`
  )
  const info = statement.run(goalId)
  logger.info(`Unbound ${info.changes} skills from goal ${goalId}`)
}

// ============================================================================
// 注册表查询操作
// ============================================================================

/**
 * 获取特定 Goal 当前“可见”的所有 Task-Scoped 技能的 ID 列表
 */
export function getBoundSkillsForGoal(goalId: string): string[] {
  const statement = getDb().prepare(
    `SELECT skill_id FROM active_contexts WHERE goal_id = ?`
  )
  const rows = statement.all(goalId) as { skill_id: string }[]
  return rows.map(r => r.skill_id)
}

/**
 * 获取某个技能的默认作用域设定
 */
export function getSkillScope(skillId: string): 'core' | 'task' | 'persistent' {
  const statement = getDb().prepare(
    `SELECT scope FROM installed_capabilities WHERE skill_id = ?`
  )
  const row = statement.get(skillId) as { scope: string } | undefined
  if (!row) {
    // 默认回退为 persistent
    return 'persistent'
  }
  return row.scope as 'core' | 'task' | 'persistent'
}

export function upsertExperienceRule(input: UpsertExperienceRuleInput): number {
  const now = Date.now()
  const scopeType = input.scopeType ?? 'global'
  const scopeId = normalizeScopeId(scopeType, input.scopeId)
  const scene = normalizeScene(input.scene)
  const pattern = normalizePattern(input.pattern)
  const instruction = input.instruction.trim()
  const priority = input.priority ?? 50
  const confidence = clampConfidence(input.confidence ?? 0.6)
  const enabled = input.enabled === false ? 0 : 1
  const source = (input.source || 'manual').trim() || 'manual'
  const expiresAt = input.expiresAt ?? null

  getDb().prepare(`
    INSERT INTO experience_rules (
      scope_type, scope_id, scene, pattern, instruction,
      priority, confidence, enabled, source, created_at, updated_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_type, scope_id, scene, pattern)
    DO UPDATE SET
      instruction = excluded.instruction,
      priority = excluded.priority,
      confidence = excluded.confidence,
      enabled = excluded.enabled,
      source = excluded.source,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).run(
    scopeType,
    scopeId,
    scene,
    pattern,
    instruction,
    priority,
    confidence,
    enabled,
    source,
    now,
    now,
    expiresAt
  )

  const row = getDb()
    .prepare(`SELECT id FROM experience_rules WHERE scope_type = ? AND scope_id = ? AND scene = ? AND pattern = ?`)
    .get(scopeType, scopeId, scene, pattern) as { id: number } | undefined

  return row?.id ?? 0
}

export function getExperienceRulesForGoal(query: ExperienceRuleQuery): ExperienceRule[] {
  const now = Date.now()
  const userId = (query.userId || '').trim()
  const sceneFilter = (query.scene || '').trim() ? normalizeScene(query.scene) : null
  const goalText = (query.goalText || '').toLowerCase()
  const limit = Math.max(1, Math.min(query.limit ?? 8, 50))

  const rows = getDb().prepare(`
    SELECT
      id, scope_type, scope_id, scene, pattern, instruction, priority, confidence,
      enabled, source, hit_count, effective_count, ineffective_count, effective_streak,
      last_hit_at, last_effective_at, created_at, updated_at, expires_at
    FROM experience_rules
    WHERE enabled = 1
      AND (expires_at IS NULL OR expires_at > ?)
      AND (? IS NULL OR scene = ? OR scene = 'general' OR scene = '*')
      AND (
        (scope_type = 'global' AND scope_id = '')
        OR (scope_type = 'user' AND scope_id = ?)
      )
    ORDER BY priority DESC, confidence DESC, updated_at DESC
    LIMIT 200
  `).all(now, sceneFilter, sceneFilter, userId) as Array<{
    id: number
    scope_type: ExperienceScopeType
    scope_id: string
    scene: string
    pattern: string
    instruction: string
    priority: number
    confidence: number
    enabled: number
    source: string
    hit_count: number
    effective_count: number
    ineffective_count: number
    effective_streak: number
    last_hit_at: number | null
    last_effective_at: number | null
    created_at: number
    updated_at: number
    expires_at: number | null
  }>

  const normalizedText = goalText.trim()
  return rows
    .map(mapExperienceRuleRow)
    .filter((rule) => {
      if (!normalizedText) return true
      return matchPattern(rule.pattern, normalizedText)
    })
    .slice(0, limit)
}

export function recordExperienceEvent(input: ExperienceEventInput): number {
  const now = Date.now()
  const scene = normalizeScene(input.scene)
  const signal = (input.signal || '').trim()
  const payloadJson = serializePayload(input.payload)
  const success =
    input.success === undefined || input.success === null ? null : (input.success ? 1 : 0)

  const info = getDb().prepare(`
    INSERT INTO experience_events (
      rule_id, event_type, scene, signal, payload_json, success, user_id, goal_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.ruleId ?? null,
    input.eventType,
    scene,
    signal,
    payloadJson,
    success,
    input.userId || '',
    input.goalId || '',
    now
  )

  const maybeId = (info as { lastInsertRowid?: number | bigint }).lastInsertRowid
  if (maybeId !== undefined && maybeId !== null) return Number(maybeId)
  const fallback = getDb()
    .query('SELECT last_insert_rowid() as id')
    .get() as { id: number | bigint } | undefined
  return Number(fallback?.id || 0)
}

export function autoPromoteExperienceRule(input: AutoPromoteExperienceInput): AutoPromoteExperienceResult {
  const enabled = input.enabled !== false
  if (!enabled) {
    return { promoted: false, recentCount: 0, reason: 'disabled' }
  }

  const eventType = input.eventType.trim()
  if (!eventType) {
    return { promoted: false, recentCount: 0, reason: 'missing_event_type' }
  }

  const scene = normalizeScene(input.scene)
  const signal = (input.signal || '').trim().toLowerCase() || 'none'
  const scopeType = input.scopeType ?? 'global'
  const scopeId = normalizeScopeId(scopeType, input.userId)
  const threshold = Math.max(2, Math.min(input.threshold ?? 3, 20))
  const windowMinutes = Math.max(5, Math.min(input.windowMinutes ?? 120, 24 * 60))
  const windowStart = Date.now() - windowMinutes * 60 * 1000
  const failedOnlyCount = !isRecoveryLikeEvent(eventType)

  const queryByUser = scopeType === 'user'
  const countRow = getDb().prepare(`
    SELECT COUNT(*) as c
    FROM experience_events
    WHERE event_type = ?
      AND scene = ?
      AND signal = ?
      AND created_at >= ?
      AND (? = 0 OR success IS NULL OR success = 0)
      AND (? = 0 OR user_id = ?)
  `).get(
    eventType,
    scene,
    signal,
    windowStart,
    failedOnlyCount ? 1 : 0,
    queryByUser ? 1 : 0,
    scopeId
  ) as { c: number } | undefined

  const recentCount = countRow?.c || 0
  if (recentCount < threshold) {
    return { promoted: false, recentCount, reason: 'threshold_not_reached' }
  }

  const template = deriveAutoRuleTemplate(eventType, scene, signal)
  if (!template) {
    return { promoted: false, recentCount, reason: 'no_template' }
  }

  const existing = getDb().prepare(`
    SELECT id, updated_at
    FROM experience_rules
    WHERE scope_type = ? AND scope_id = ? AND scene = ? AND pattern = ?
  `).get(scopeType, scopeId, template.scene, template.pattern) as
    | { id: number; updated_at: number }
    | undefined

  const cooldownMs = Math.max(5 * 60 * 1000, Math.floor(windowMinutes * 60 * 1000 / 2))
  if (existing && Date.now() - existing.updated_at < cooldownMs) {
    return { promoted: false, recentCount, ruleId: existing.id, reason: 'cooldown' }
  }

  const boostedConfidence = Math.min(
    0.97,
    Math.max(template.confidence, 0.55 + recentCount * 0.06)
  )
  const ruleId = upsertExperienceRule({
    scopeType,
    scopeId,
    scene: template.scene,
    pattern: template.pattern,
    instruction: template.instruction,
    priority: template.priority,
    confidence: boostedConfidence,
    enabled: true,
    source: `auto:${eventType}:${signal}`,
  })

  return { promoted: true, recentCount, ruleId }
}

export function enqueueExperienceProcessing(eventId: number): void {
  if (!Number.isInteger(eventId) || eventId <= 0) return
  const now = Date.now()
  getDb().prepare(`
    INSERT OR IGNORE INTO experience_processing_queue (
      event_id, status, attempts, available_at, created_at, updated_at
    ) VALUES (?, 'pending', 0, ?, ?, ?)
  `).run(eventId, now, now, now)
}

export async function drainExperienceProcessingQueue(
  options: ExperienceQueueDrainOptions = {}
): Promise<ExperienceQueueDrainResult> {
  const now = Date.now()
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 200))
  const autoPromoteEnabled = options.autoPromoteEnabled !== false
  const scope = options.autoPromoteScope ?? 'global'
  const threshold = options.autoPromoteThreshold ?? 3
  const windowMinutes = options.autoPromoteWindowMinutes ?? 120

  const result: ExperienceQueueDrainResult = {
    claimed: 0,
    processed: 0,
    promoted: 0,
    refined: 0,
    failed: 0,
  }

  // 异常恢复：处理进程中断导致的 processing 卡死任务
  const staleProcessingThreshold = now - 5 * 60 * 1000
  getDb().prepare(`
    UPDATE experience_processing_queue
    SET status = 'pending', updated_at = ?
    WHERE status = 'processing' AND updated_at < ?
  `).run(now, staleProcessingThreshold)

  const pendingRows = getDb().prepare(`
    SELECT id, event_id, attempts
    FROM experience_processing_queue
    WHERE status = 'pending' AND available_at <= ?
    ORDER BY id ASC
    LIMIT ?
  `).all(now, batchSize) as Array<{ id: number; event_id: number; attempts: number }>

  if (pendingRows.length === 0) return result

  for (const row of pendingRows) {
    const claim = getDb().prepare(`
      UPDATE experience_processing_queue
      SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, row.id)
    if ((claim.changes || 0) === 0) continue
    result.claimed++

    try {
      const eventRow = getDb().prepare(`
        SELECT id, event_type, scene, signal, payload_json, success, user_id, goal_id, created_at
        FROM experience_events
        WHERE id = ?
      `).get(row.event_id) as
        | {
            id: number
            event_type: string
            scene: string
            signal: string
            payload_json: string | null
            success: number | null
            user_id: string
            goal_id: string
            created_at: number
          }
        | undefined

      if (!eventRow) {
        markQueueJobDone(row.id)
        result.processed++
        continue
      }

      if (autoPromoteEnabled) {
        const promoted = autoPromoteExperienceRule({
          eventType: eventRow.event_type,
          scene: eventRow.scene,
          signal: eventRow.signal,
          userId: eventRow.user_id,
          scopeType: scope,
          threshold,
          windowMinutes,
          enabled: true,
        })
        if (promoted.promoted && promoted.ruleId) {
          result.promoted++
          if (options.refinePromotedRule) {
            const rule = getDb().prepare(`
              SELECT instruction
              FROM experience_rules
              WHERE id = ?
            `).get(promoted.ruleId) as { instruction: string } | undefined

            if (rule?.instruction) {
              const refined = await options.refinePromotedRule({
                ruleId: promoted.ruleId,
                eventType: eventRow.event_type,
                scene: eventRow.scene,
                signal: eventRow.signal,
                userId: eventRow.user_id,
                goalId: eventRow.goal_id,
                instruction: rule.instruction,
                recentCount: promoted.recentCount,
              })
              if (refined && refined.trim() && refined.trim() !== rule.instruction.trim()) {
                getDb().prepare(`
                  UPDATE experience_rules
                  SET instruction = ?, updated_at = ?, source = ?
                  WHERE id = ?
                `).run(refined.trim(), Date.now(), 'auto:llm-refined', promoted.ruleId)
                result.refined++
              }
            }
          }
        }
      }

      markQueueJobDone(row.id)
      result.processed++
    } catch (error) {
      result.failed++
      markQueueJobRetry(row.id, row.attempts + 1, String(error))
    }
  }

  return result
}

export function cleanupExperienceProcessingQueue(
  options: ExperienceQueueCleanupOptions = {}
): ExperienceQueueCleanupResult {
  const now = Date.now()
  const retentionHours = Math.max(1, Math.min(options.retentionHours ?? 72, 24 * 90))
  const maxRowsPerRun = Math.max(100, Math.min(options.maxRowsPerRun ?? 2000, 20_000))
  const staleFailedAttempts = Math.max(1, Math.min(options.staleFailedAttempts ?? 3, 20))
  const cutoff = now - retentionHours * 60 * 60 * 1000

  const doneResult = getDb().prepare(`
    DELETE FROM experience_processing_queue
    WHERE id IN (
      SELECT id
      FROM experience_processing_queue
      WHERE status = 'done' AND updated_at < ?
      ORDER BY id ASC
      LIMIT ?
    )
  `).run(cutoff, maxRowsPerRun)

  const failedResult = getDb().prepare(`
    DELETE FROM experience_processing_queue
    WHERE id IN (
      SELECT id
      FROM experience_processing_queue
      WHERE updated_at < ?
        AND (
          status = 'failed'
          OR (status = 'pending' AND last_error IS NOT NULL AND attempts >= ?)
        )
      ORDER BY id ASC
      LIMIT ?
    )
  `).run(cutoff, staleFailedAttempts, maxRowsPerRun)

  return {
    deletedDone: doneResult.changes || 0,
    deletedFailed: failedResult.changes || 0,
  }
}

export function recordExperienceRuleHits(input: ExperienceRuleHitInput): void {
  const ids = normalizeRuleIds(input.ruleIds)
  if (ids.length === 0) return
  const now = Date.now()
  const scene = normalizeScene(input.scene)
  const signal = (input.phase || 'runtime').trim()

  const updateStmt = getDb().prepare(`
    UPDATE experience_rules
    SET hit_count = COALESCE(hit_count, 0) + 1,
        last_hit_at = ?,
        updated_at = ?
    WHERE id = ?
  `)
  const eventStmt = getDb().prepare(`
    INSERT INTO experience_events (
      rule_id, event_type, scene, signal, payload_json, success, user_id, goal_id, created_at
    ) VALUES (?, 'rule_hit', ?, ?, ?, NULL, ?, ?, ?)
  `)

  for (const id of ids) {
    updateStmt.run(now, now, id)
    eventStmt.run(
      id,
      scene,
      signal,
      JSON.stringify({ phase: signal }),
      input.userId || '',
      input.goalId || '',
      now
    )
  }
}

export function reinforceExperienceRules(input: ReinforceExperienceRulesInput): void {
  const ids = normalizeRuleIds(input.ruleIds)
  if (ids.length === 0) return
  const now = Date.now()
  const scene = normalizeScene(input.scene)
  const reason = (input.reason || '').trim() || input.outcome
  const onlyAuto = input.onlyAuto !== false

  const selectStmt = getDb().prepare(`
    SELECT id, source, confidence, priority,
           COALESCE(effective_count, 0) as effective_count,
           COALESCE(ineffective_count, 0) as ineffective_count,
           COALESCE(effective_streak, 0) as effective_streak
    FROM experience_rules
    WHERE id = ?
  `)

  const updateEffectiveStmt = getDb().prepare(`
    UPDATE experience_rules
    SET confidence = ?,
        priority = ?,
        effective_count = ?,
        effective_streak = ?,
        last_effective_at = ?,
        updated_at = ?
    WHERE id = ?
  `)

  const updateIneffectiveStmt = getDb().prepare(`
    UPDATE experience_rules
    SET confidence = ?,
        priority = ?,
        ineffective_count = ?,
        effective_streak = 0,
        updated_at = ?
    WHERE id = ?
  `)

  const eventStmt = getDb().prepare(`
    INSERT INTO experience_events (
      rule_id, event_type, scene, signal, payload_json, success, user_id, goal_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const id of ids) {
    const row = selectStmt.get(id) as
      | {
          id: number
          source: string
          confidence: number
          priority: number
          effective_count: number
          ineffective_count: number
          effective_streak: number
        }
      | undefined

    if (!row) continue
    if (onlyAuto && !String(row.source || '').startsWith('auto:')) continue

    if (input.outcome === 'effective') {
      const newEffectiveCount = row.effective_count + 1
      const newStreak = row.effective_streak + 1
      const confidenceBoost = newStreak >= 3 ? 0.03 : newStreak === 2 ? 0.02 : 0.01
      const priorityBoost = newStreak > 0 && newStreak % 3 === 0 ? 1 : 0
      const newConfidence = clampConfidence((row.confidence || 0.6) + confidenceBoost)
      const newPriority = clampPriority((row.priority || 50) + priorityBoost)

      updateEffectiveStmt.run(
        newConfidence,
        newPriority,
        newEffectiveCount,
        newStreak,
        now,
        now,
        id
      )

      eventStmt.run(
        id,
        'rule_effective',
        scene,
        reason,
        JSON.stringify({
          confidenceBoost,
          newConfidence,
          newPriority,
          effectiveCount: newEffectiveCount,
          effectiveStreak: newStreak,
        }),
        1,
        input.userId || '',
        input.goalId || '',
        now
      )
      continue
    }

    const newIneffectiveCount = row.ineffective_count + 1
    const confidencePenalty = 0.03
    const priorityPenalty = newIneffectiveCount % 4 === 0 ? 1 : 0
    const newConfidence = clampConfidenceRange((row.confidence || 0.6) - confidencePenalty, 0.2, 0.99)
    const newPriority = clampPriority((row.priority || 50) - priorityPenalty, 20, 100)

    updateIneffectiveStmt.run(
      newConfidence,
      newPriority,
      newIneffectiveCount,
      now,
      id
    )

    eventStmt.run(
      id,
      'rule_ineffective',
      scene,
      reason,
      JSON.stringify({
        confidencePenalty,
        newConfidence,
        newPriority,
        ineffectiveCount: newIneffectiveCount,
      }),
      0,
      input.userId || '',
      input.goalId || '',
      now
    )
  }
}

function seedDefaultExperienceRules(): void {
  let inserted = 0
  const now = Date.now()

  for (const rule of DEFAULT_EXPERIENCE_RULES) {
    const scopeType = rule.scopeType ?? 'global'
    const scopeId = normalizeScopeId(scopeType, rule.scopeId)
    const scene = normalizeScene(rule.scene)
    const pattern = normalizePattern(rule.pattern)
    const instruction = rule.instruction.trim()

    const info = getDb().prepare(`
      INSERT OR IGNORE INTO experience_rules (
        scope_type, scope_id, scene, pattern, instruction,
        priority, confidence, enabled, source, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scopeType,
      scopeId,
      scene,
      pattern,
      instruction,
      rule.priority ?? 50,
      clampConfidence(rule.confidence ?? 0.6),
      rule.enabled === false ? 0 : 1,
      rule.source || 'seed',
      now,
      now,
      rule.expiresAt ?? null
    )

    if ((info.changes || 0) > 0) inserted++
  }

  if (inserted > 0) {
    logger.info(`Seeded ${inserted} default experience rules`)
  }
}

function deriveAutoRuleTemplate(
  eventType: string,
  scene: string,
  signal: string
): {
  scene: string
  pattern: string
  instruction: string
  priority: number
  confidence: number
} | null {
  if (eventType === 'loop_guard_blocked' && signal === 'local_psql_probe') {
    return {
      scene: 'database',
      pattern: 'postgres,postgresql,psql,数据库,sql',
      instruction: '检测到本地 psql 探测重复失败时，禁止继续探测；改为使用远程连接信息或输出外部执行指令。',
      priority: 95,
      confidence: 0.85,
    }
  }

  if (eventType === 'loop_guard_blocked' && signal === 'local_package_manager_probe') {
    return {
      scene: 'environment',
      pattern: 'winget,choco,apt,brew,package manager,安装',
      instruction: '本地包管理器探测/安装重复失败时，不再重试安装链路，直接切换到无安装方案或外部执行方案。',
      priority: 92,
      confidence: 0.82,
    }
  }

  if (eventType === 'duplicate_tool_call_blocked') {
    return {
      scene: scene === 'general' ? 'general' : scene,
      pattern: '重复,duplicate,loop,重试',
      instruction: '同一工具调用被判定重复后，必须复用已有结果并切换策略，禁止继续同参重试。',
      priority: 90,
      confidence: 0.8,
    }
  }

  if (eventType === 'max_iterations_reached') {
    return {
      scene: 'general',
      pattern: '迭代,iterations,loop,重试',
      instruction: '接近最大迭代轮数时优先收敛输出：总结已有证据、明确剩余缺口、给出下一步最小行动。',
      priority: 86,
      confidence: 0.76,
    }
  }

  if (eventType === 'tool_call_failed') {
    return {
      scene: scene === 'general' ? 'general' : scene,
      pattern: signal === 'none' ? '失败,error,failed' : signal,
      instruction: '同类工具失败反复出现时，及时停止同路径重试并转向替代工具或降级方案。',
      priority: 84,
      confidence: 0.72,
    }
  }

  if (eventType === 'tool_call_recovered') {
    return {
      scene: scene === 'general' ? 'general' : scene,
      pattern: signal === 'none' ? '恢复,recovered,重试成功' : signal,
      instruction: '同类调用出现“先失败后成功”时，后续优先复用已验证成功的路径，减少盲目试错。',
      priority: 88,
      confidence: 0.79,
    }
  }

  return null
}

function mapExperienceRuleRow(row: {
  id: number
  scope_type: ExperienceScopeType
  scope_id: string
  scene: string
  pattern: string
  instruction: string
  priority: number
  confidence: number
  enabled: number
  source: string
  hit_count: number
  effective_count: number
  ineffective_count: number
  effective_streak: number
  last_hit_at: number | null
  last_effective_at: number | null
  created_at: number
  updated_at: number
  expires_at: number | null
}): ExperienceRule {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scene: row.scene,
    pattern: row.pattern,
    instruction: row.instruction,
    priority: row.priority,
    confidence: row.confidence,
    enabled: row.enabled === 1,
    source: row.source,
    hitCount: row.hit_count || 0,
    effectiveCount: row.effective_count || 0,
    ineffectiveCount: row.ineffective_count || 0,
    effectiveStreak: row.effective_streak || 0,
    lastHitAt: row.last_hit_at,
    lastEffectiveAt: row.last_effective_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

function matchPattern(pattern: string, textLower: string): boolean {
  const normalized = pattern.trim()
  if (!normalized || normalized === '*') return true

  if (normalized.startsWith('re:')) {
    try {
      const re = new RegExp(normalized.slice(3), 'i')
      return re.test(textLower)
    } catch {
      return false
    }
  }

  const tokens = normalized
    .split(/[\n,|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  if (tokens.length === 0) return true
  return tokens.some((token) => textLower.includes(token))
}

function normalizeScene(scene?: string): string {
  const normalized = (scene || 'general').trim().toLowerCase()
  return normalized || 'general'
}

function normalizePattern(pattern?: string): string {
  const normalized = (pattern || '*').trim()
  return normalized || '*'
}

function normalizeScopeId(scopeType: ExperienceScopeType, scopeId?: string): string {
  if (scopeType === 'global') return ''
  return (scopeId || '').trim()
}

function clampConfidence(confidence: number): number {
  return clampConfidenceRange(confidence, 0, 1)
}

function clampConfidenceRange(confidence: number, min: number, max: number): number {
  if (!Number.isFinite(confidence)) return 0.6
  if (confidence < min) return min
  if (confidence > max) return max
  return confidence
}

function serializePayload(payload: unknown): string | null {
  if (payload === undefined) return null
  try {
    return JSON.stringify(payload)
  } catch {
    return JSON.stringify({ value: String(payload) })
  }
}

function isRecoveryLikeEvent(eventType: string): boolean {
  return eventType === 'tool_call_recovered' || eventType === 'tool_call_succeeded'
}

function markQueueJobDone(queueId: number): void {
  getDb().prepare(`
    UPDATE experience_processing_queue
    SET status = 'done', last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), queueId)
}

function markQueueJobRetry(queueId: number, attempts: number, error: string): void {
  const now = Date.now()
  const backoffMs = Math.min(15 * 60 * 1000, Math.max(30_000, attempts * 30_000))
  getDb().prepare(`
    UPDATE experience_processing_queue
    SET status = 'pending',
        last_error = ?,
        available_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(error.slice(0, 500), now + backoffMs, now, queueId)
}

function clampPriority(priority: number, min = 1, max = 100): number {
  if (!Number.isFinite(priority)) return 50
  if (priority < min) return min
  if (priority > max) return max
  return Math.round(priority)
}

function normalizeRuleIds(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)))
}

function ensureColumnExists(database: Database, table: string, column: string, ddl: string): void {
  const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  const exists = rows.some((row) => row.name === column)
  if (!exists) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}
