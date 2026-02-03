/**
 * Skill Type Definitions
 */

import { z } from 'zod'
import type { TaskContext, SkillResult } from './protocol'

/** Skill Execution Context */
export interface SkillContext extends TaskContext {
  /** Working Directory */
  workDir: string
}

/** Skill Definition */
export interface Skill {
  /** Skill Name */
  name: string
  /** Skill Description */
  description: string
  /** Input Arguments Schema (Zod) */
  inputSchema: z.ZodType<unknown>
  /** Execution Handler */
  handler: (ctx: SkillContext, args: unknown) => Promise<SkillResult>
}

/** Skill Registry */
export type SkillRegistry = Map<string, Skill>
