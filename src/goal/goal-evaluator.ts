/**
 * Goal Evaluator - 目标完成评估器
 *
 * 系统的"中枢神经"。只做一件事：判断目标是否完成。
 *
 * 职责：
 * - 接收 Goal + Artifacts → 判断目标是否完成
 * - 输出结构化 EvaluationResult（JSON only）
 * - 只做判断，不执行，不建议步骤
 *
 * 原则：
 * - 不允许自由文本
 * - 不允许建议执行步骤
 * - 只做判断
 */

import type { LLMAdapter } from '../llm/adapter'
import type { Goal, EvaluationResult, SuccessCriterion } from '../types/goal'
import type { Message } from '../types'
import { Logger } from '../utils/logger'

const logger = new Logger('GoalEvaluator')

// ============================================================================
// Evaluator Prompt
// ============================================================================

const EVALUATOR_SYSTEM_PROMPT = `You are a goal completion evaluator. Your ONLY job is to determine whether a goal has been completed based on its success criteria and available artifacts.

## Rules
1. You MUST return valid JSON only. No other text.
2. You MUST NOT suggest actions or next steps.
3. You MUST NOT execute anything.
4. You MUST evaluate each criterion independently.
5. A criterion is "satisfied" ONLY if the artifacts clearly and sufficiently address it.
6. Do NOT be overly optimistic - when in doubt, mark as missing.
7. Artifact names alone are NOT sufficient - you must consider whether the content meaningfully addresses the criterion.

## Output Format
Return EXACTLY this JSON structure:
{
  "completed": boolean,
  "criteria": [
    {
      "id": "criterion_id",
      "satisfied": boolean,
      "reason": "brief explanation"
    }
  ]
}

- "completed" is true ONLY when ALL criteria are satisfied.
- Each criterion must have a clear reason for its satisfied/missing status.`

// ============================================================================
// Evaluator Implementation
// ============================================================================

/** 评估器输入（与 LLM 解耦，方便测试） */
export interface EvaluatorInput {
  goal: Goal
}

/** LLM 返回的原始评估结果 */
interface RawEvaluatorOutput {
  completed: boolean
  criteria: Array<{
    id: string
    satisfied: boolean
    reason: string
  }>
}

/**
 * 使用 LLM 评估目标完成度
 */
export async function evaluateGoal(
  llm: LLMAdapter,
  input: EvaluatorInput
): Promise<EvaluationResult> {
  const { goal } = input

  // 构建评估输入消息
  const userMessage = buildEvaluatorUserMessage(goal)

  // 调用 LLM
  const responseText = await callLLMForText(llm, EVALUATOR_SYSTEM_PROMPT, userMessage)

  // 解析 JSON 响应
  const rawResult = parseEvaluatorResponse(responseText)

  // 转换为 EvaluationResult
  return toEvaluationResult(goal, rawResult)
}

/**
 * 构建评估输入消息
 */
function buildEvaluatorUserMessage(goal: Goal): string {
  const criteriaList = goal.successCriteria
    .map((c) => `- [${c.id}] ${c.description}`)
    .join('\n')

  const artifactsList =
    goal.artifacts.length > 0
      ? goal.artifacts
          .map((a) => `### ${a.name}\n${a.description}\n\`\`\`\n${a.content}\n\`\`\``)
          .join('\n\n')
      : '(No artifacts available)'

  const constraintsList =
    goal.constraints.length > 0
      ? goal.constraints.map((c) => `- ${c}`).join('\n')
      : '(No constraints)'

  return `## Goal
${goal.description}

## Success Criteria
${criteriaList}

## Constraints
${constraintsList}

## Available Artifacts
${artifactsList}

Evaluate whether the goal is completed. Return JSON only.`
}

/**
 * 调用 LLM 并收集完整文本响应
 */
async function callLLMForText(
  llm: LLMAdapter,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const messages: Message[] = [
    { role: 'user', content: userMessage },
  ]

  let fullText = ''

  const stream = llm.chat({
    messages,
    systemPrompt,
    tools: [], // 评估器不需要工具
  })

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      fullText += event.content
    } else if (event.type === 'error') {
      throw new Error(`LLM error during evaluation: ${event.message}`)
    }
  }

  return fullText
}

/**
 * 解析 LLM 的 JSON 响应
 */
function parseEvaluatorResponse(responseText: string): RawEvaluatorOutput {
  // 尝试提取 JSON（LLM 可能会在前后加文本）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.error(`Failed to extract JSON from evaluator response: ${responseText.slice(0, 200)}`)
    throw new Error('Evaluator response does not contain valid JSON')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as RawEvaluatorOutput

    // 基本结构校验
    if (typeof parsed.completed !== 'boolean') {
      throw new Error('Missing or invalid "completed" field')
    }
    if (!Array.isArray(parsed.criteria)) {
      throw new Error('Missing or invalid "criteria" array')
    }

    return parsed
  } catch (error) {
    logger.error(`Failed to parse evaluator JSON: ${error}`)
    throw new Error(`Evaluator response JSON parse error: ${error}`)
  }
}

/**
 * 将 LLM 原始输出转换为 EvaluationResult
 */
function toEvaluationResult(goal: Goal, raw: RawEvaluatorOutput): EvaluationResult {
  const satisfied: SuccessCriterion[] = []
  const missing: SuccessCriterion[] = []

  for (const criterion of goal.successCriteria) {
    const llmResult = raw.criteria.find((c) => c.id === criterion.id)

    if (llmResult?.satisfied) {
      satisfied.push({ ...criterion, satisfied: true })
    } else {
      missing.push({ ...criterion, satisfied: false })
    }
  }

  // 一致性检查：completed 必须与全部满足一致
  const allSatisfied = missing.length === 0
  const completed = allSatisfied && raw.completed

  if (raw.completed !== allSatisfied) {
    logger.warn(
      `Evaluator inconsistency: completed=${raw.completed} but ${missing.length} criteria still missing. Using stricter check.`
    )
  }

  return { completed, satisfied, missing }
}

// ============================================================================
// 导出 Prompt（供测试使用）
// ============================================================================

/** 获取评估器的 system prompt（供测试/调试使用） */
export function getEvaluatorSystemPrompt(): string {
  return EVALUATOR_SYSTEM_PROMPT
}

/** 构建评估器的 user message（供测试/调试使用） */
export function buildEvaluatorMessage(goal: Goal): string {
  return buildEvaluatorUserMessage(goal)
}
