/**
 * Goal Manager - 目标管理器
 *
 * 负责：
 * - 目标的 CRUD 生命周期管理
 * - 目标状态流转
 * - Artifact 管理
 * - 成功标准更新
 *
 * 原则：
 * - 纯数据管理，不包含 LLM 调用逻辑
 * - 初期使用内存存储，后续可持久化
 */

import { v4 as uuid } from 'uuid'
import type {
  Goal,
  GoalStatus,
  GoalArtifact,
  SuccessCriterion,
} from '../types/goal'
import { Logger } from '../utils/logger'

const logger = new Logger('GoalManager')

// ============================================================================
// 存储
// ============================================================================

/** 目标存储（内存） */
const goals: Map<string, Goal> = new Map()

// ============================================================================
// CRUD 操作
// ============================================================================

/**
 * 创建目标
 */
export function createGoal(input: {
  userId: string
  description: string
  successCriteria?: string[]
  constraints?: string[]
}): Goal {
  const { userId, description, successCriteria = [], constraints = [] } = input

  const goal: Goal = {
    id: uuid(),
    userId,
    description,
    successCriteria: successCriteria.map((desc, i) => ({
      id: `criterion_${i + 1}`,
      description: desc,
      satisfied: false,
    })),
    constraints,
    status: 'pending',
    artifacts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  goals.set(goal.id, goal)
  logger.info(`Created goal: ${goal.id} - "${description.slice(0, 50)}..."`)
  return goal
}

/**
 * 获取目标
 */
export function getGoal(goalId: string): Goal | undefined {
  return goals.get(goalId)
}

/**
 * 获取用户的活跃目标
 */
export function getActiveGoals(userId: string): Goal[] {
  const activeStatuses: GoalStatus[] = ['pending', 'planning', 'running', 'blocked']
  return Array.from(goals.values()).filter(
    (g) => g.userId === userId && activeStatuses.includes(g.status)
  )
}

/**
 * 更新目标状态
 */
export function updateGoalStatus(goalId: string, status: GoalStatus): Goal | undefined {
  const goal = goals.get(goalId)
  if (!goal) {
    logger.warn(`Goal not found: ${goalId}`)
    return undefined
  }

  const oldStatus = goal.status
  goal.status = status
  goal.updatedAt = Date.now()
  logger.info(`Goal ${goalId} status: ${oldStatus} -> ${status}`)
  return goal
}

/**
 * 添加产出物
 */
export function addArtifact(goalId: string, artifact: GoalArtifact): Goal | undefined {
  const goal = goals.get(goalId)
  if (!goal) {
    logger.warn(`Goal not found: ${goalId}`)
    return undefined
  }

  goal.artifacts.push(artifact)
  goal.updatedAt = Date.now()
  logger.info(`Added artifact "${artifact.name}" to goal ${goalId}`)
  return goal
}

/**
 * 更新成功标准状态
 */
export function updateCriterion(
  goalId: string,
  criterionId: string,
  satisfied: boolean
): Goal | undefined {
  const goal = goals.get(goalId)
  if (!goal) {
    logger.warn(`Goal not found: ${goalId}`)
    return undefined
  }

  const criterion = goal.successCriteria.find((c) => c.id === criterionId)
  if (!criterion) {
    logger.warn(`Criterion not found: ${criterionId} in goal ${goalId}`)
    return undefined
  }

  criterion.satisfied = satisfied
  goal.updatedAt = Date.now()
  logger.info(`Criterion ${criterionId} in goal ${goalId}: satisfied=${satisfied}`)
  return goal
}

/**
 * 批量更新成功标准（根据评估结果）
 */
export function applyCriteriaUpdate(
  goalId: string,
  satisfiedIds: string[],
  missingIds: string[]
): Goal | undefined {
  const goal = goals.get(goalId)
  if (!goal) return undefined

  for (const c of goal.successCriteria) {
    if (satisfiedIds.includes(c.id)) {
      c.satisfied = true
    } else if (missingIds.includes(c.id)) {
      c.satisfied = false
    }
  }

  goal.updatedAt = Date.now()
  return goal
}

/**
 * 设置目标的成功标准（通常由 LLM 在规划阶段生成）
 */
export function setSuccessCriteria(
  goalId: string,
  criteria: string[]
): Goal | undefined {
  const goal = goals.get(goalId)
  if (!goal) return undefined

  goal.successCriteria = criteria.map((desc, i) => ({
    id: `criterion_${i + 1}`,
    description: desc,
    satisfied: false,
  }))
  goal.updatedAt = Date.now()
  logger.info(`Set ${criteria.length} criteria for goal ${goalId}`)
  return goal
}

/**
 * 删除目标
 */
export function deleteGoal(goalId: string): boolean {
  const deleted = goals.delete(goalId)
  if (deleted) {
    logger.info(`Deleted goal: ${goalId}`)
  }
  return deleted
}

/**
 * 清除所有目标（测试用）
 */
export function clearAllGoals(): void {
  goals.clear()
}
