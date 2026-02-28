/**
 * Goal Planner - 目标规划器
 *
 * 负责：
 * - 将用户目标拆解为可执行步骤（PlanStep[]）
 * - 为目标生成成功标准（如用户未指定）
 * - 当步骤失败时重新规划
 *
 * 原则：
 * - 使用 LLM 进行规划，输出结构化 JSON
 * - 不执行任何步骤
 */

import type { LLMAdapter } from '../llm/adapter'
import type { Goal, PlanStep } from '../types/goal'
import type { Message } from '../types'
import { Logger } from '../utils/logger'
import { loadSkills, getDefaultSkillsDir } from '../skills'

const logger = new Logger('GoalPlanner')

// ============================================================================
// Planner Prompt
// ============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a goal planning agent. Your job is to decompose a user's goal into a sequence of actionable steps.

## Context
You are operating via OpenVia, a CLI gateway with access to:
- bash: Execute shell commands
- read_file: Read file contents
- write_file: Write content to file
- edit_file: Edit file by replacing content

## Rules
1. Return valid JSON only. No other text.
2. Each step must be a concrete, executable action (not vague like "analyze data"). DO PREFER using provided skills over raw bash commands when applicable.
3. Steps should be ordered by dependency - do prerequisites first.
4. Each step's description should be clear enough that an AI agent can execute it with the available tools.
5. Generate 2-8 steps. Avoid over-decomposition.
6. DO NOT generate steps to "search for", "list", or "find" skills. The available skills are already given to you below. Use them directly!
7. If the goal already has success criteria, generate steps that address ALL criteria.
8. If no success criteria are provided, also generate appropriate criteria.
9. NEVER add a preparatory step like "check if tools/skills exist" unless the user explicitly asked for environment diagnostics.
10. For simple information tasks (weather/time/news/price), prefer 1-2 direct steps: fetch required data, then answer.
11. For domain-specific goals (database optimization/OCR/browser automation/video transcript/api sdk generation), if matching capability is not already installed, your first step SHOULD be capability discovery via \`npx skills find\` + install + bind.
12. Avoid writing large local scripts/files in step 1 when the capability gap has not been resolved yet.

## Output Format
{
  "criteria": ["criterion 1", "criterion 2", ...],
  "steps": [
    {
      "description": "Clear, actionable step description"
    }
  ]
}

- "criteria": Success criteria for the goal. If the goal already has criteria, return them as-is.
- "steps": Ordered list of steps to achieve the goal.`

// ============================================================================
// Planner Implementation
// ============================================================================

/** 规划结果 */
export interface PlanResult {
  criteria: string[]
  steps: PlanStep[]
}

/**
 * 为目标生成执行计划
 */
export async function planGoal(
  llm: LLMAdapter,
  goal: Goal
): Promise<PlanResult> {
  const userMessage = await buildPlannerUserMessage(goal)
  const responseText = await callLLMForText(llm, PLANNER_SYSTEM_PROMPT, userMessage)
  const parsed = parsePlannerResponse(responseText)
  return await enforceCapabilityDiscoveryIfNeeded(goal, parsed)
}

/**
 * 当步骤失败时重新规划
 */
export async function replanGoal(
  llm: LLMAdapter,
  goal: Goal,
  failedStepIndex: number,
  failureReason: string
): Promise<PlanResult> {
  const userMessage = await buildReplanUserMessage(goal, failedStepIndex, failureReason)
  const responseText = await callLLMForText(llm, PLANNER_SYSTEM_PROMPT, userMessage)
  const parsed = parsePlannerResponse(responseText)
  return await enforceCapabilityDiscoveryIfNeeded(goal, parsed)
}

// ============================================================================
// 内部实现
// ============================================================================

async function buildPlannerUserMessage(goal: Goal): Promise<string> {
  const criteriaSection = goal.successCriteria.length > 0
    ? `## Existing Success Criteria\n${goal.successCriteria.map(c => `- ${c.description}`).join('\n')}`
    : '## Success Criteria\n(Not specified - please generate appropriate criteria)'

  const constraintsSection = goal.constraints.length > 0
    ? `## Constraints\n${goal.constraints.map(c => `- ${c}`).join('\n')}`
    : ''

  const availableSkills = await getDynamicSkillsContext()

  return `## Goal
${goal.description}

${criteriaSection}

${constraintsSection}

${availableSkills}

Please decompose this goal into actionable steps. Return JSON only.`
}

async function buildReplanUserMessage(
  goal: Goal,
  failedStepIndex: number,
  failureReason: string
): Promise<string> {
  const completedSteps = goal.plan?.steps
    .filter(s => s.status === 'completed')
    .map(s => `- [DONE] ${s.description}${s.result ? ': ' + s.result : ''}`)
    .join('\n') || '(None)'

  const failedStep = goal.plan?.steps[failedStepIndex]
  const availableSkills = await getDynamicSkillsContext()

  return `## Goal
${goal.description}

## Success Criteria
${goal.successCriteria.map(c => `- [${c.satisfied ? 'DONE' : 'TODO'}] ${c.description}`).join('\n')}

## Completed Steps
${completedSteps}

## Failed Step
- Step: ${failedStep?.description || 'Unknown'}
- Reason: ${failureReason}

${availableSkills}

Please generate a new plan to complete the remaining criteria, considering the failure above. Return JSON only.`
}

async function getDynamicSkillsContext(): Promise<string> {
  try {
    const skillsDir = getDefaultSkillsDir()
    const { skills } = await loadSkills(skillsDir)
    const visibleSkills = skills

    if (visibleSkills.length === 0) return ''

    return `## Available Skills
You can directly rely on these installed skills and MUST NOT create a separate "tool checking" step:
${visibleSkills.map((s) => `- ${s.id}: ${s.metadata.description || s.metadata.name}`).join('\n')}`
  } catch {
    return ''
  }
}

type CapabilityGapRule = {
  query: string
  reason: string
  keywords: string[]
  matchSkillKeywords: string[]
}

const CAPABILITY_GAP_RULES: CapabilityGapRule[] = [
  {
    query: 'postgres',
    reason: 'PostgreSQL 数据库连接/分析',
    keywords: ['postgres', 'postgresql', 'psql', '数据库', '索引优化', 'sql优化'],
    matchSkillKeywords: ['postgres', 'postgresql', 'neon', 'supabase'],
  },
  {
    query: 'ocr',
    reason: 'OCR 识别能力',
    keywords: ['ocr', '识别', '扫描件', '发票', '图片文字'],
    matchSkillKeywords: ['ocr', 'tesseract', 'vision', 'invoice'],
  },
  {
    query: 'playwright',
    reason: '动态网页抓取/浏览器自动化',
    keywords: ['动态网页', '渲染', 'playwright', 'browser', '登录后页面', '自动化'],
    matchSkillKeywords: ['playwright', 'browser', 'puppeteer', 'selenium'],
  },
  {
    query: 'youtube transcript',
    reason: '视频转录能力',
    keywords: ['youtube', '视频转文字', '转录', '字幕'],
    matchSkillKeywords: ['youtube', 'transcript', 'subtitle', 'video'],
  },
]

async function enforceCapabilityDiscoveryIfNeeded(goal: Goal, plan: PlanResult): Promise<PlanResult> {
  const gap = await detectCapabilityGap(goal.description)
  if (!gap) return plan

  const alreadyHasDiscoveryStep = plan.steps.some((s) => {
    const d = s.description.toLowerCase()
    return d.includes('npx skills find') || d.includes('skills add') || d.includes('bind_skill')
  })
  if (alreadyHasDiscoveryStep) return plan

  const discoveryStep: PlanStep = {
    id: 'step_discovery',
    description: `当前任务可能存在能力缺口（${gap.reason}）。先用 bash 执行 "npx skills find ${gap.query}"，选择合适技能后执行 "npx skills add <owner/repo@skill> -g -y"，安装成功后调用 bind_skill 绑定到当前 Goal，再继续后续步骤。`,
    status: 'pending',
  }

  const merged = [discoveryStep, ...plan.steps].map((s, i) => ({
    ...s,
    id: `step_${i + 1}`,
    status: 'pending' as const,
  }))

  logger.info(`Capability gap detected (${gap.query}), prepended discovery step`)
  return { ...plan, steps: merged }
}

async function detectCapabilityGap(goalDescription: string): Promise<CapabilityGapRule | null> {
  const goalLower = goalDescription.toLowerCase()

  const skillsDir = getDefaultSkillsDir()
  const { skills } = await loadSkills(skillsDir)
  const installedTokens = skills
    .flatMap((s) => [s.id, s.metadata.name || '', s.metadata.description || ''])
    .map((t) => t.toLowerCase())

  for (const rule of CAPABILITY_GAP_RULES) {
    const mentionsDomain = rule.keywords.some((k) => goalLower.includes(k))
    if (!mentionsDomain) continue

    const hasMatchingSkill = installedTokens.some((token) =>
      rule.matchSkillKeywords.some((k) => token.includes(k))
    )
    if (!hasMatchingSkill) {
      return rule
    }
  }

  return null
}

async function callLLMForText(
  llm: LLMAdapter,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const messages: Message[] = [
    { role: 'user', content: userMessage },
  ]

  let fullText = ''

  for await (const event of llm.chat({
    messages,
    systemPrompt,
    tools: [],
  })) {
    if (event.type === 'text_delta') {
      fullText += event.content
    } else if (event.type === 'error') {
      throw new Error(`LLM error during planning: ${event.message}`)
    }
  }

  return fullText
}

function parsePlannerResponse(responseText: string): PlanResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.error(`Failed to extract JSON from planner response: ${responseText.slice(0, 200)}`)
    throw new Error('Planner response does not contain valid JSON')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      criteria?: string[]
      steps?: Array<{ description: string }>
    }

    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : []
    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : []

    if (rawSteps.length === 0) {
      throw new Error('Planner returned no steps')
    }

    const steps: PlanStep[] = rawSteps.map((s, i) => ({
      id: `step_${i + 1}`,
      description: s.description || `Step ${i + 1}`,
      status: 'pending' as const,
    }))

    logger.info(`Planned ${steps.length} steps, ${criteria.length} criteria`)
    return { criteria, steps }

  } catch (error) {
    logger.error(`Failed to parse planner JSON: ${error}`)
    throw new Error(`Planner response JSON parse error: ${error}`)
  }
}
