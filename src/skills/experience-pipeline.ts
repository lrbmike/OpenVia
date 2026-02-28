import type { LLMAdapter } from '../llm/adapter'
import { Logger } from '../utils/logger'
import {
  cleanupExperienceProcessingQueue,
  drainExperienceProcessingQueue,
  type ExperienceScopeType,
} from './registry'

const logger = new Logger('ExperiencePipeline')

export interface ExperiencePipelineConfig {
  enabled?: boolean
  intervalMs?: number
  batchSize?: number
  queueCleanupEnabled?: boolean
  queueRetentionHours?: number
  queueCleanupIntervalMs?: number
  queueCleanupBatchSize?: number
  queueStaleFailedAttempts?: number
  autoPromoteEnabled?: boolean
  autoPromoteScope?: ExperienceScopeType
  autoPromoteThreshold?: number
  autoPromoteWindowMinutes?: number
  summarizer?: {
    enabled?: boolean
    adapter?: LLMAdapter
    systemPrompt?: string
    maxInstructionLength?: number
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let cfg: ExperiencePipelineConfig = {}
let lastCleanupAt = 0

const DEFAULT_SUMMARIZER_PROMPT =
  '你是经验规则提炼器。基于事件上下文输出一条可复用的中文规则。只输出规则正文，不要解释。'

export function startExperiencePipeline(config: ExperiencePipelineConfig): void {
  stopExperiencePipeline()
  lastCleanupAt = 0
  cfg = {
    enabled: config.enabled !== false,
    intervalMs: Math.max(500, config.intervalMs ?? 2000),
    batchSize: Math.max(1, config.batchSize ?? 20),
    queueCleanupEnabled: config.queueCleanupEnabled !== false,
    queueRetentionHours: Math.max(1, config.queueRetentionHours ?? 72),
    queueCleanupIntervalMs: Math.max(30_000, config.queueCleanupIntervalMs ?? 10 * 60 * 1000),
    queueCleanupBatchSize: Math.max(100, config.queueCleanupBatchSize ?? 2000),
    queueStaleFailedAttempts: Math.max(1, config.queueStaleFailedAttempts ?? 3),
    autoPromoteEnabled: config.autoPromoteEnabled !== false,
    autoPromoteScope: config.autoPromoteScope ?? 'global',
    autoPromoteThreshold: config.autoPromoteThreshold ?? 3,
    autoPromoteWindowMinutes: config.autoPromoteWindowMinutes ?? 120,
    summarizer: config.summarizer,
  }

  if (!cfg.enabled) {
    logger.info('Experience pipeline disabled by config')
    return
  }

  timer = setInterval(() => {
    void runExperiencePipelineTick()
  }, cfg.intervalMs)

  // 启动后先跑一次，避免首个周期等待过长
  void runExperiencePipelineTick()
  logger.info(`Experience pipeline started (interval=${cfg.intervalMs}ms, batch=${cfg.batchSize})`)
}

export function stopExperiencePipeline(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info('Experience pipeline stopped')
  }
}

async function runExperiencePipelineTick(): Promise<void> {
  if (!cfg.enabled || running) return
  running = true
  try {
    const drained = await drainExperienceProcessingQueue({
      batchSize: cfg.batchSize,
      autoPromoteEnabled: cfg.autoPromoteEnabled,
      autoPromoteScope: cfg.autoPromoteScope,
      autoPromoteThreshold: cfg.autoPromoteThreshold,
      autoPromoteWindowMinutes: cfg.autoPromoteWindowMinutes,
      refinePromotedRule: buildRefiner(cfg),
    })

    if (drained.claimed > 0 || drained.promoted > 0 || drained.failed > 0) {
      logger.info(
        `Queue drained: claimed=${drained.claimed}, processed=${drained.processed}, promoted=${drained.promoted}, refined=${drained.refined}, failed=${drained.failed}`
      )
    }

    maybeCleanupQueue()
  } catch (error) {
    logger.warn(`Experience pipeline tick failed: ${error}`)
  } finally {
    running = false
  }
}

function maybeCleanupQueue(): void {
  if (!cfg.queueCleanupEnabled) return
  const now = Date.now()
  const interval = Math.max(30_000, cfg.queueCleanupIntervalMs ?? 10 * 60 * 1000)
  if (lastCleanupAt > 0 && now - lastCleanupAt < interval) return

  const cleanupResult = cleanupExperienceProcessingQueue({
    retentionHours: cfg.queueRetentionHours,
    maxRowsPerRun: cfg.queueCleanupBatchSize,
    staleFailedAttempts: cfg.queueStaleFailedAttempts,
  })
  lastCleanupAt = now

  if (cleanupResult.deletedDone > 0 || cleanupResult.deletedFailed > 0) {
    logger.info(
      `Queue cleanup: deletedDone=${cleanupResult.deletedDone}, deletedFailed=${cleanupResult.deletedFailed}`
    )
  }
}

function buildRefiner(config: ExperiencePipelineConfig) {
  const summarizer = config.summarizer
  if (!summarizer?.enabled || !summarizer.adapter) return undefined

  const adapter = summarizer.adapter
  const systemPrompt = summarizer.systemPrompt || DEFAULT_SUMMARIZER_PROMPT
  const maxInstructionLength = Math.max(60, summarizer.maxInstructionLength ?? 160)

  return async (input: {
    ruleId: number
    eventType: string
    scene: string
    signal: string
    userId: string
    goalId: string
    instruction: string
    recentCount: number
  }): Promise<string | null> => {
    const userMessage = `请将下面经验提炼为一条规则（中文，最多${maxInstructionLength}字）：\n` +
      `eventType=${input.eventType}\nscene=${input.scene}\nsignal=${input.signal}\nrecentCount=${input.recentCount}\n` +
      `currentInstruction=${input.instruction}\n` +
      '要求：可执行、可复用、避免空话。仅输出规则文本。'

    let text = ''
    for await (const event of adapter.chat({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      tools: [],
    })) {
      if (event.type === 'text_delta') text += event.content
      if (event.type === 'error') return null
    }

    const refined = text.trim().replace(/^["'`\s]+|["'`\s]+$/g, '')
    if (!refined) return null
    if (refined.length > maxInstructionLength) return refined.slice(0, maxInstructionLength)
    return refined
  }
}
