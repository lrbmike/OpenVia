/**
 * Goal Loop - 目标执行循环
 *
 * 目标驱动的核心执行流程：
 *   接收目标 → Planning → 逐步执行 → 评估 → 未完成？继续/重规划 → 完成
 *
 * 关键设计：
 * - 复用现有 callAgent 处理每个步骤，不重写工具调用逻辑
 * - 每轮执行后调用 GoalEvaluator 判断进展
 * - 通过 sendReply 向用户发送进度更新
 */

import type { LLMAdapter } from '../llm/adapter'
import type { Goal } from '../types/goal'
import type { Message } from '../types'
import { createGoal, getGoal, updateGoalStatus, addArtifact, setSuccessCriteria, applyCriteriaUpdate } from './goal-manager'
import { evaluateGoal } from './goal-evaluator'
import { planGoal, replanGoal } from './goal-planner'
import { callAgent } from '../ai/agent-client'
import type { RequestContext } from '../ai/agent-client'
import { Logger } from '../utils/logger'
import {
  getExperienceRulesForGoal,
  recordExperienceRuleHits,
  reinforceExperienceRules,
  type ExperienceRule,
} from '../skills/registry'

const logger = new Logger('GoalLoop')

// ============================================================================
// 配置
// ============================================================================

/** GoalLoop 配置 */
export interface GoalLoopConfig {
  /** 最大执行步骤数 */
  maxSteps: number
  /** 最大评估轮数（防止无限循环） */
  maxEvaluationRounds: number
  /** 步骤失败后最大重规划次数 */
  maxReplans: number
  /** 技能管理类步骤最大迭代 */
  maxStepIterationsSkill: number
  /** 普通步骤最大迭代 */
  maxStepIterationsDefault: number
  /** 网络/API 类步骤最大迭代 */
  maxStepIterationsNetwork: number
  /** 数据库/分析类步骤最大迭代 */
  maxStepIterationsData: number
  /** 已提供远程目标信息的步骤最大迭代 */
  maxStepIterationsRemoteTarget: number
  /** 远程目标线索关键字/模式（字符串包含匹配） */
  remoteTargetHints: string[]
  /** 数据类任务关键词（用于迭代预算） */
  dataSceneKeywords: string[]
  /** 网络类任务关键词（用于迭代预算） */
  networkSceneKeywords: string[]
}

const DEFAULT_CONFIG: GoalLoopConfig = {
  maxSteps: 20,
  maxEvaluationRounds: 12,
  maxReplans: 2,
  maxStepIterationsSkill: 14,
  maxStepIterationsDefault: 10,
  maxStepIterationsNetwork: 12,
  maxStepIterationsData: 14,
  maxStepIterationsRemoteTarget: 16,
  remoteTargetHints: [
    'host:',
    'hostname:',
    'server:',
    'endpoint:',
    'postgresql://',
    'mysql://',
    'mongodb://',
    'redis://',
    'jdbc:',
    '.com',
    '.net',
    '.org',
  ],
  dataSceneKeywords: [
    'postgres',
    'postgresql',
    'mysql',
    'redis',
    'mongodb',
    'database',
    '数据库',
    'sql',
    '索引',
    'analyze',
    '分析',
  ],
  networkSceneKeywords: [
    'http',
    'https',
    'api',
    'endpoint',
    'url',
    'fetch',
    '网络',
    '远程',
    'socket',
  ],
}

// ============================================================================
// GoalLoop 实现
// ============================================================================

/** GoalLoop 执行结果 */
export interface GoalLoopResult {
  goalId: string
  completed: boolean
  summary: string
}

/**
 * 执行目标驱动循环
 *
 * @param llm - LLM 适配器（用于规划和评估）
 * @param goalDescription - 用户目标描述
 * @param userId - 用户 ID
 * @param requestContext - 请求上下文（含 sendReply）
 * @param history - 对话历史
 * @param config - 循环配置
 */
export async function runGoalLoop(
  llm: LLMAdapter,
  goalDescription: string,
  userId: string,
  requestContext: RequestContext,
  history: Message[],
  config: Partial<GoalLoopConfig> = {}
): Promise<GoalLoopResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const { sendReply } = requestContext

  // ── 1. 创建目标 ──
  const goal = createGoal({ userId, description: goalDescription })
  await updateGoalStatus(goal.id, 'planning')
  await sendReply(`🎯 **目标已创建**\n> ${goalDescription}\n\n⏳ 正在规划执行步骤...`)

  // ── 2. 规划 ──
  let planResult
  try {
    planResult = await planGoal(llm, goal)
  } catch (error) {
    await updateGoalStatus(goal.id, 'failed')
    const msg = error instanceof Error ? error.message : String(error)
    await sendReply(`❌ 目标规划失败: ${msg}`)
    return { goalId: goal.id, completed: false, summary: `Planning failed: ${msg}` }
  }

  // 设置成功标准和执行计划
  if (planResult.criteria.length > 0 && goal.successCriteria.length === 0) {
    setSuccessCriteria(goal.id, planResult.criteria)
  }

  const updatedGoal = getGoal(goal.id)!
  updatedGoal.plan = {
    steps: planResult.steps,
    currentStepIndex: 0,
  }
  updatedGoal.updatedAt = Date.now()
  // 动态评估轮数保护：至少覆盖“计划步数 + 重规划次数 + 缓冲”
  let effectiveMaxEvaluationRounds = Math.max(
    cfg.maxEvaluationRounds,
    updatedGoal.plan.steps.length + cfg.maxReplans + 4
  )

  // 向用户展示计划
  const planSummary = planResult.steps
    .map((s, i) => `${i + 1}. ${s.description}`)
    .join('\n')
  const criteriaSummary = (updatedGoal.successCriteria.length > 0
    ? updatedGoal.successCriteria.map(c => `  ✅ ${c.description}`).join('\n')
    : '  (由 AI 动态判断)')

  await sendReply(`📋 **执行计划**\n\n**成功标准:**\n${criteriaSummary}\n\n**步骤:**\n${planSummary}\n\n🚀 开始执行...`)

  // ── 3. 逐步执行 ──
  await updateGoalStatus(goal.id, 'running')
  let replanCount = 0
  let totalStepsExecuted = 0

  for (let round = 0; round < effectiveMaxEvaluationRounds; round++) {
    const currentGoal = getGoal(goal.id)!
    if (!currentGoal.plan) break

    const plan = currentGoal.plan

    // 每次仅执行一个步骤，执行后立即进行评估（Early Evaluation 机制）
    if (plan.currentStepIndex < plan.steps.length && totalStepsExecuted < cfg.maxSteps) {
      const stepIndex = plan.currentStepIndex
      const step = plan.steps[stepIndex]
      totalStepsExecuted++

      step.status = 'running'
      await sendReply(`⚙️ **步骤 ${stepIndex + 1}/${plan.steps.length}**: ${step.description}`)

      // 复用现有 callAgent 执行步骤，传入 currentGoal.id 参数以便只加载对应的 Task-Scoped Skills
      const stepInstructionBundle = buildStepInstruction(step.description, currentGoal, cfg)
      const stepInstruction = stepInstructionBundle.instruction
      if (stepInstructionBundle.appliedRuleIds.length > 0) {
        recordExperienceRuleHits({
          ruleIds: stepInstructionBundle.appliedRuleIds,
          userId: currentGoal.userId,
          goalId: currentGoal.id,
          scene: stepInstructionBundle.scene,
          phase: 'goal_step_execution',
        })
      }
      const lowerStep = step.description.toLowerCase()
      const isSkillManagementStep =
        lowerStep.includes('skill') ||
        lowerStep.includes('技能') ||
        lowerStep.includes('capability') ||
        lowerStep.includes('能力')
      const stepMaxIterations = inferStepMaxIterations(step.description, currentGoal.description, cfg)
      const runtimeOptions = isSkillManagementStep
        ? { maxIterations: Math.max(cfg.maxStepIterationsSkill, stepMaxIterations) }
        : { deniedTools: ['list_skills', 'read_skill'], maxIterations: stepMaxIterations }
      const stepResult = await callAgent(
        stepInstruction,
        { history },
        requestContext,
        currentGoal.id,
        runtimeOptions
      )

      if (stepResult.action === 'reply' && stepResult.message) {
        const normalizedStepResult = normalizeStepResult(stepResult.message)
        step.status = 'completed'
        step.result = normalizedStepResult

        const stepOutcome = inferStepOutcome(stepResult.message)
        if (stepOutcome === 'effective' && stepInstructionBundle.autoRuleIds.length > 0) {
          reinforceExperienceRules({
            ruleIds: stepInstructionBundle.autoRuleIds,
            outcome: 'effective',
            userId: currentGoal.userId,
            goalId: currentGoal.id,
            scene: stepInstructionBundle.scene,
            reason: 'goal_step_completed_needsMoreTools_false',
            onlyAuto: true,
          })
        }

        // 将步骤输出作为 artifact 记录
        addArtifact(goal.id, {
          name: `step_${stepIndex + 1}_result`,
          description: `步骤 "${step.description}" 的执行结果`,
          content: normalizedStepResult,
        })

        // 将步骤结果添加到历史（供后续步骤参考）
        history.push(
          { role: 'user', content: stepInstruction },
          { role: 'assistant', content: normalizedStepResult }
        )
      } else {
        step.status = 'failed'
        step.result = stepResult.message || 'Unknown error'
        logger.warn(`Step ${stepIndex + 1} failed: ${step.result}`)

        if (stepInstructionBundle.autoRuleIds.length > 0) {
          reinforceExperienceRules({
            ruleIds: stepInstructionBundle.autoRuleIds,
            outcome: 'ineffective',
            userId: currentGoal.userId,
            goalId: currentGoal.id,
            scene: stepInstructionBundle.scene,
            reason: 'goal_step_failed',
            onlyAuto: true,
          })
        }

        // 尝试重规划
        if (replanCount < cfg.maxReplans) {
          replanCount++
          await sendReply(`⚠️ 步骤 ${stepIndex + 1} 失败，正在重新规划 (${replanCount}/${cfg.maxReplans})...`)

          try {
            const newPlan = await replanGoal(llm, currentGoal, stepIndex, step.result)
            currentGoal.plan = {
              steps: newPlan.steps,
              currentStepIndex: 0,
            }
            effectiveMaxEvaluationRounds = Math.max(
              effectiveMaxEvaluationRounds,
              totalStepsExecuted + newPlan.steps.length + (cfg.maxReplans - replanCount) + 3
            )
            continue // 跳出当前步骤，用新计划进入下一轮
          } catch {
            logger.error('Replan failed, continuing with remaining steps')
          }
        }
      }

      plan.currentStepIndex = stepIndex + 1
      currentGoal.updatedAt = Date.now()
    }

    // ── 4. 评估 ──
    const evalGoal = getGoal(goal.id)!
    const allStepsDone = evalGoal.plan && evalGoal.plan.currentStepIndex >= evalGoal.plan.steps.length

    if (evalGoal.successCriteria.length === 0) {
      if (allStepsDone) {
        // 无成功标准的情况下，计划全执行完才算完成
        await updateGoalStatus(goal.id, 'completed')
        await sendReply('✅ **目标已完成**（所有步骤已执行）')
        return { goalId: goal.id, completed: true, summary: 'All steps executed' }
      } else {
        // 还有步骤未执行，直接进入下一轮
        continue
      }
    }

    await sendReply('🔍 正在评估目标完成度...')

    try {
      const evalResult = await evaluateGoal(llm, { goal: evalGoal })
      applyCriteriaUpdate(
        goal.id,
        evalResult.satisfied.map((c) => c.id),
        evalResult.missing.map((c) => c.id)
      )

      if (evalResult.completed) {
        await updateGoalStatus(goal.id, 'completed')
        const satisfiedList = evalResult.satisfied
          .map(c => `  ✅ ${c.description}`)
          .join('\n')
          
        let finalResultMsg = ''
        if (evalGoal.artifacts && evalGoal.artifacts.length > 0) {
          const lastResult = evalGoal.artifacts[evalGoal.artifacts.length - 1]
          finalResultMsg = `\n\n**最终结果:**\n${lastResult.content}`
        }
        
        await sendReply(`🎉 **目标已完成！**\n\n**已满足的标准:**\n${satisfiedList}${finalResultMsg}`)
        return { goalId: goal.id, completed: true, summary: 'Goal completed successfully' }
      }

      // 未完成 - 展示进度
      const satisfiedList = evalResult.satisfied
        .map(c => `  ✅ ${c.description}`)
        .join('\n')
      const missingList = evalResult.missing
        .map(c => `  ❌ ${c.description}`)
        .join('\n')

      // 检查是否还能继续
      if (allStepsDone && replanCount >= cfg.maxReplans) {
        // 无法继续
        await updateGoalStatus(goal.id, 'blocked')
        await sendReply(
          `⚠️ **目标未完成（已达最大尝试次数）**\n\n**已完成:**\n${satisfiedList || '  (无)'}\n\n**未完成:**\n${missingList}`
        )
        return { goalId: goal.id, completed: false, summary: `Blocked: ${evalResult.missing.length} criteria unmet` }
      }

      // 尝试重规划来完成缺失项
      if (allStepsDone && replanCount < cfg.maxReplans) {
        replanCount++
        await sendReply(
          `📊 **进度更新**\n\n**已完成:**\n${satisfiedList || '  (无)'}\n\n**未完成:**\n${missingList}\n\n🔄 重新规划以完成剩余标准 (${replanCount}/${cfg.maxReplans})...`
        )

        try {
          const newPlan = await replanGoal(
            llm,
            evalGoal,
            evalGoal.plan!.currentStepIndex - 1,
            `Missing criteria: ${evalResult.missing.map(c => c.description).join(', ')}`
          )
          evalGoal.plan = {
            steps: newPlan.steps,
            currentStepIndex: 0,
          }
          evalGoal.updatedAt = Date.now()
          effectiveMaxEvaluationRounds = Math.max(
            effectiveMaxEvaluationRounds,
            totalStepsExecuted + newPlan.steps.length + (cfg.maxReplans - replanCount) + 3
          )
          // 继续下一轮循环
        } catch {
          await updateGoalStatus(goal.id, 'blocked')
          await sendReply(`⚠️ **重新规划失败，目标暂停**\n\n**未完成:**\n${missingList}`)
          return { goalId: goal.id, completed: false, summary: 'Replan failed' }
        }
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`Evaluation failed: ${msg}`)
      // 评估失败不应该阻止继续，标记为 blocked
      await updateGoalStatus(goal.id, 'blocked')
      await sendReply(`⚠️ 目标评估失败: ${msg}`)
      return { goalId: goal.id, completed: false, summary: `Evaluation failed: ${msg}` }
    }
  }

  // 超过最大评估轮数
  await updateGoalStatus(goal.id, 'blocked')
  const finalGoal = getGoal(goal.id)
  const finalPlan = finalGoal?.plan
  const stepProgress = finalPlan ? `${Math.min(finalPlan.currentStepIndex, finalPlan.steps.length)}/${finalPlan.steps.length}` : 'unknown'
  await sendReply(`⚠️ **目标执行已达最大轮数 (${effectiveMaxEvaluationRounds})，已暂停。**\n\n当前步骤进度: ${stepProgress}`)
  return { goalId: goal.id, completed: false, summary: 'Max evaluation rounds reached' }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将步骤描述转换为可执行的指令
 */
interface StepInstructionBundle {
  instruction: string
  scene: string
  appliedRuleIds: number[]
  autoRuleIds: number[]
}

function buildStepInstruction(stepDescription: string, goal: Goal, cfg: GoalLoopConfig): StepInstructionBundle {
  // 把已经产出的数据发给接下来的步骤
  let artifactsContext = ''
  if (goal.artifacts && goal.artifacts.length > 0) {
    const recentArtifacts = goal.artifacts.slice(-3)
    const arts = recentArtifacts
      .map((a) => {
        const content = a.content.length > 2000 ? `${a.content.slice(0, 2000)}...(truncated)` : a.content
        return `### ${a.name} (${a.description})\n${content}`
      })
      .join('\n\n')
    artifactsContext = `\n## Previous Steps Artifacts\nYou can USE the following information gathered from previous steps to complete your task:\n${arts}\n`
  }

  const remoteTargetHint = hasExplicitRemoteTargetHint(goal.description, cfg)
    ? `
## Remote Target Constraint (Strict)
The goal contains explicit remote target connection information.
- Prioritize remote execution using user-provided target info.
- Avoid local environment probing/installation as default strategy.
- Only do local dependency checks when a direct remote attempt has already failed and the check is strictly necessary.
- If current environment cannot execute remotely, output an external-run guide with exact commands and expected outputs.
`
    : ''

  const scene = inferGoalSceneForLoop(`${goal.description}\n${stepDescription}`, cfg)
  let experienceRules: ExperienceRule[] = []
  try {
    experienceRules = getExperienceRulesForGoal({
      userId: goal.userId,
      scene,
      goalText: `${goal.description}\n${stepDescription}`,
      limit: 4,
    })
  } catch {
    experienceRules = []
  }
  const appliedRuleIds = experienceRules.map((r) => r.id)
  const autoRuleIds = experienceRules
    .filter((r) => String(r.source || '').startsWith('auto:'))
    .map((r) => r.id)
  const experienceHint = experienceRules.length > 0
    ? `
## Experience Rules
${experienceRules.map((r) => `- ${r.instruction}`).join('\n')}
`
    : ''

  const instruction = `You are executing a step as part of a larger goal.

## Current Goal
${goal.description}
${artifactsContext}
${remoteTargetHint}
${experienceHint}
## Your Current Task
${stepDescription}

## Instructions
- Complete ONLY the task described above.
- Be thorough but focused.
- Use the same language as the user's goal description when writing your final answer.
- Use existing artifacts first. If required information is already present, DO NOT call any tool.
- Do NOT call \`list_skills\` or \`read_skill\` unless this step is explicitly about skill management.
- If one tool result already gives enough data for this step, stop and produce the step result immediately.
- If you produce any output or files, include the key content in your response.
- Report what you accomplished.
- At the end, include a fenced block \`\`\`goal_step_result ... \`\`\` with JSON:
  {"summary":"...", "evidence":["..."], "criteriaHints":["..."], "needsMoreTools": false}`

  return {
    instruction,
    scene,
    appliedRuleIds,
    autoRuleIds,
  }
}

function normalizeStepResult(raw: string): string {
  const parsed = parseStepResultBlock(raw)
  if (parsed) {
    const evidence = parsed.evidence.slice(0, 5).map((e) => `- ${e}`).join('\n')
    const hints = parsed.criteriaHints.slice(0, 5).map((c) => `- ${c}`).join('\n')
    return [
      `摘要: ${parsed.summary}`,
      evidence ? `依据:\n${evidence}` : '',
      hints ? `达成提示:\n${hints}` : '',
      `是否需要继续调用工具: ${parsed.needsMoreTools ? '是' : '否'}`,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000)
  }

  return raw
    .slice(0, 4000)
    .replace(/^Summary:\s*/gim, '摘要: ')
    .replace(/^Evidence:\s*/gim, '依据: ')
    .replace(/^CriteriaHints:\s*/gim, '达成提示: ')
    .replace(/^NeedsMoreTools:\s*false\s*$/gim, '是否需要继续调用工具: 否')
    .replace(/^NeedsMoreTools:\s*true\s*$/gim, '是否需要继续调用工具: 是')
}

function parseStepResultBlock(raw: string): {
  summary: string
  evidence: string[]
  criteriaHints: string[]
  needsMoreTools: boolean
} | null {
  const match = raw.match(/```goal_step_result\s*([\s\S]*?)```/i)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[1].trim()) as {
      summary?: unknown
      evidence?: unknown
      criteriaHints?: unknown
      needsMoreTools?: unknown
    }
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.filter((x): x is string => typeof x === 'string') : []
    const criteriaHints = Array.isArray(parsed.criteriaHints)
      ? parsed.criteriaHints.filter((x): x is string => typeof x === 'string')
      : []
    const needsMoreTools = typeof parsed.needsMoreTools === 'boolean' ? parsed.needsMoreTools : false

    if (!summary) return null
    return { summary, evidence, criteriaHints, needsMoreTools }
  } catch {
    return null
  }
}

function inferStepOutcome(raw: string): 'effective' | 'unknown' {
  const parsed = parseStepResultBlock(raw)
  if (parsed) {
    return parsed.needsMoreTools ? 'unknown' : 'effective'
  }

  if (/NeedsMoreTools:\s*false/i.test(raw)) return 'effective'
  if (/是否需要继续调用工具:\s*否/.test(raw)) return 'effective'
  return 'unknown'
}

function hasExplicitRemoteTargetHint(text: string, cfg: GoalLoopConfig): boolean {
  const lower = text.toLowerCase()
  const hasIpPort = /\b\d{1,3}(?:\.\d{1,3}){3}\s*:\s*\d{2,5}\b/.test(text)
  const hasHostPort =
    /(host|hostname|server|endpoint)\s*[:=]\s*[\w.-]+/i.test(text) &&
    /(port)\s*[:=]\s*\d{2,5}/i.test(text)
  const hasConnString = /([a-z]+:\/\/)/i.test(text)
  const hasHostLike = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(text)
  const hasCustomHint = cfg.remoteTargetHints.some((hint) => lower.includes(hint.toLowerCase()))

  return hasIpPort || hasHostPort || hasConnString || hasHostLike || hasCustomHint
}

function inferStepMaxIterations(stepDescription: string, goalDescription: string, cfg: GoalLoopConfig): number {
  const text = `${stepDescription}\n${goalDescription}`.toLowerCase()

  const dataLike = cfg.dataSceneKeywords.some((kw) => text.includes(kw.toLowerCase()))
  const networkLike = cfg.networkSceneKeywords.some((kw) => text.includes(kw.toLowerCase()))

  if (hasExplicitRemoteTargetHint(goalDescription, cfg)) return cfg.maxStepIterationsRemoteTarget
  if (dataLike) return cfg.maxStepIterationsData
  if (networkLike) return cfg.maxStepIterationsNetwork
  return cfg.maxStepIterationsDefault
}

function inferGoalSceneForLoop(text: string, cfg: GoalLoopConfig): string {
  const lower = text.toLowerCase()
  if (hasExplicitRemoteTargetHint(text, cfg)) return 'network'
  if (cfg.dataSceneKeywords.some((kw) => lower.includes(kw.toLowerCase()))) return 'database'
  if (cfg.networkSceneKeywords.some((kw) => lower.includes(kw.toLowerCase()))) return 'network'
  return 'general'
}
