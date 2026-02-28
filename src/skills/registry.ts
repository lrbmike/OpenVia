import { Database } from 'bun:sqlite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Logger } from '../utils/logger'

const logger = new Logger('CapabilityRegistry')

/** 全局单例 DB 实例 */
let db: Database | null = null

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
  scope: 'core' | 'task' | 'persistent' = 'persistent'
): void {
  const statement = getDb().prepare(
    `INSERT OR REPLACE INTO installed_capabilities (skill_id, name, description, scope) 
     VALUES (?, ?, ?, ?)`
  )
  statement.run(skillId, name, description, scope)
  logger.info(`Registered skill: ${skillId} (scope: ${scope})`)
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
