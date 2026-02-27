/**
 * Goal Types - 目标驱动架构核心类型定义
 *
 * 定义 Goal-Driven Agent 系统中目标、成功标准、执行计划等核心概念。
 */

// ============================================================================
// 目标状态
// ============================================================================

/** 目标生命周期状态 */
export type GoalStatus =
  | 'pending'     // 已创建，等待规划
  | 'planning'    // 正在生成执行计划
  | 'running'     // 正在执行
  | 'blocked'     // 执行受阻（缺少能力/需要用户输入）
  | 'completed'   // 已完成
  | 'failed'      // 失败

// ============================================================================
// 成功标准
// ============================================================================

/** 单个成功标准 */
export interface SuccessCriterion {
  /** 标准 ID */
  id: string
  /** 标准描述 */
  description: string
  /** 是否已满足 */
  satisfied: boolean
}

// ============================================================================
// 目标产出物
// ============================================================================

/** 目标产出物 */
export interface GoalArtifact {
  /** 产出物名称 */
  name: string
  /** 产出物描述 */
  description: string
  /** 产出物内容 */
  content: string
}

// ============================================================================
// 执行计划
// ============================================================================

/** 计划步骤状态 */
export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 计划步骤 */
export interface PlanStep {
  /** 步骤 ID */
  id: string
  /** 步骤描述 */
  description: string
  /** 步骤状态 */
  status: PlanStepStatus
  /** 执行结果摘要 */
  result?: string
}

/** 执行计划（由 LLM 在 planning 阶段生成） */
export interface GoalPlan {
  /** 计划步骤列表 */
  steps: PlanStep[]
  /** 当前执行到的步骤索引 */
  currentStepIndex: number
}

// ============================================================================
// 目标定义
// ============================================================================

/** 目标定义 */
export interface Goal {
  /** 目标 ID */
  id: string
  /** 所属用户 ID */
  userId: string
  /** 用户原始目标描述 */
  description: string
  /** 成功标准列表 */
  successCriteria: SuccessCriterion[]
  /** 约束条件 */
  constraints: string[]
  /** 目标状态 */
  status: GoalStatus
  /** 目标产出物 */
  artifacts: GoalArtifact[]
  /** 执行计划 */
  plan?: GoalPlan
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

// ============================================================================
// 评估结果
// ============================================================================

/** 目标完成评估结果 */
export interface EvaluationResult {
  /** 目标是否完成 */
  completed: boolean
  /** 已满足的标准 */
  satisfied: SuccessCriterion[]
  /** 未满足的标准 */
  missing: SuccessCriterion[]
  /** 建议的下一步行动方向（仅供 GoalLoop 参考） */
  nextAction?: string
}

// ============================================================================
// 配置
// ============================================================================

/** Goal 模式触发方式 */
export type GoalMode = 'explicit' | 'auto' | 'off'
