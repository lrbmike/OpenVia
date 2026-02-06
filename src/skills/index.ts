/**
 * Skills Module
 */

import type { ToolDefinition } from '../core/registry'
import { bashSkill } from './bash'
import { readSkill } from './read'
import { writeSkill } from './write'
import { editSkill } from './edit'

export { bashSkill } from './bash'
export { readSkill } from './read'
export { writeSkill } from './write'
export { editSkill } from './edit'

/** 所有核心 Skills */
export const coreSkills: ToolDefinition[] = [
  bashSkill,
  readSkill,
  writeSkill,
  editSkill
]
