/**
 * Tools Module - built-in tools (execution capabilities)
 *
 * Note: These are Tools, not Skills.
 * - Tools: system execution abilities like bash and file read/write.
 * - Skills: user-defined knowledge/workflows stored in ~/.openvia/skills/
 */

import type { ToolDefinition } from '../core/registry'
import { bashTool } from './bash'
import { readTool } from './read'
import { writeTool } from './write'
import { editTool } from './edit'
import { readSkillTool, listSkillsTool } from './skill'

export { bashTool } from './bash'
export { readTool } from './read'
export { writeTool } from './write'
export { editTool } from './edit'
export { readSkillTool, listSkillsTool, refreshSkillsCache } from './skill'

/** Core tools */
export const coreTools: ToolDefinition[] = [
  bashTool,
  readTool,
  writeTool,
  editTool,
  listSkillsTool,
  readSkillTool
]

