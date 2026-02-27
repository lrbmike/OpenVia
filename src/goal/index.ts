/**
 * Goal Module - 目标驱动核心模块
 */

// Goal Manager
export { createGoal, getGoal, getActiveGoals, updateGoalStatus, addArtifact, updateCriterion, applyCriteriaUpdate, setSuccessCriteria, deleteGoal, clearAllGoals } from './goal-manager'

// Goal Evaluator
export { evaluateGoal, getEvaluatorSystemPrompt, buildEvaluatorMessage } from './goal-evaluator'
export type { EvaluatorInput } from './goal-evaluator'

// Goal Planner
export { planGoal, replanGoal } from './goal-planner'
export type { PlanResult } from './goal-planner'

// Goal Loop
export { runGoalLoop } from './goal-loop'
export type { GoalLoopConfig, GoalLoopResult } from './goal-loop'
