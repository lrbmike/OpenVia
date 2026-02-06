/**
 * Communication protocol definition between Orchestrator and Claude CLI
 */

/** Conversation Message */
/** Content Block (Text or Image) */
export type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string } // data is base64

/** Conversation Message */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
}

/** Task Input - Orchestrator → Claude */
export interface TaskInput {
  /** User primitive instruction */
  task: string
  /** User ID */
  userId: string
  /** Chat ID */
  chatId: string
  /** Conversation history */
  history: Message[]
  /** Available skills list */
  skills: SkillDescription[]
  /** Constraints */
  constraints: TaskConstraints
}

/** Skill Description (to inform Claude of available skills) */
export interface SkillDescription {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Task Constraints */
export interface TaskConstraints {
  /** Maximum execution steps */
  maxSteps: number
  /** Timeout (ms) */
  timeoutMs: number
}

/** Claude Output Action Types */
export type ClaudeAction = 'run_skill' | 'reply' | 'error'

/** Claude Response - Claude → Orchestrator */
export interface ClaudeResponse {
  /** Action type */
  action: ClaudeAction
  /** Skill name (when action is run_skill) */
  skill?: string
  /** Skill arguments (when action is run_skill) */
  args?: Record<string, unknown>
  /** Reply content (when action is reply) */
  message?: string
  /** Reason for choosing this action */
  reason?: string
}

/** Skill Execution Result - Orchestrator → Claude (Callback) */
export interface SkillResultMessage {
  action: 'skill_result'
  skill: string
  result: SkillResult
}

/** Skill Execution Result */
export interface SkillResult {
  success: boolean
  data?: unknown
  error?: string
}

/** Task Context */
export interface TaskContext {
  userId: string
  chatId: string
  input: string
  history: Message[]
  allowedSkills: string[]
}
