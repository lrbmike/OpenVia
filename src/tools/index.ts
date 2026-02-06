/**
 * Tools Module - 内置工具（执行层能力）
 * 
 * 注意：这些是 Tools（工具），不是 Skills（知识扩展）
 * - Tools: 系统执行能力，如 bash、文件读写
 * - Skills: 用户定义的知识/工作流，存放在 ~/.openvia/skills/
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

/** 所有核心 Tools */
export const coreTools: ToolDefinition[] = [
  bashTool,
  readTool,
  writeTool,
  editTool,
  listSkillsTool,
  readSkillTool
]
