/**
 * Skill Tool - 读取用户定义的 Agent Skills
 * 
 * 让 LLM 可以显式调用 Skills，实现可观察的 Skill 使用
 */

import { z } from 'zod'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'
import { loadSkills, getDefaultSkillsDir, type LoadedSkill } from '../skills'
import { Logger } from '../utils/logger'

const logger = new Logger('SkillTool')

// 缓存已加载的 Skills
let cachedSkills: LoadedSkill[] | null = null

const inputSchema = z.object({
  name: z.string().describe('Name of the skill to read (directory name)')
})

/** Read Skill Tool 定义 */
export const readSkillTool: ToolDefinition = {
  name: 'read_skill',
  description: 'Read the instructions and content of a user-defined skill. Use this to get specialized knowledge or workflows for specific tasks. Call list_skills first to see available skills.',
  inputSchema,
  permissions: ['skill'],
  
  async executor(args: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
    }
    
    const { name } = parsed.data
    
    try {
      // 加载或使用缓存的 Skills
      if (!cachedSkills) {
        const skillsDir = getDefaultSkillsDir()
        const result = await loadSkills(skillsDir)
        cachedSkills = result.skills
      }
      
      // 查找指定的 Skill
      const skill = cachedSkills.find(s => s.id === name || s.metadata.name === name)
      
      if (!skill) {
        const availableSkills = cachedSkills.map(s => s.id).join(', ')
        return { 
          success: false, 
          error: `Skill "${name}" not found. Available skills: ${availableSkills || 'none'}` 
        }
      }
      
      logger.info(`Reading skill: ${skill.metadata.name} (${skill.id})`)
      
      // 返回 Skill 内容
      const content = [
        `# ${skill.metadata.name}`,
        skill.metadata.description ? `> ${skill.metadata.description}` : '',
        '',
        skill.instructions
      ].filter(Boolean).join('\n')
      
      return { 
        success: true, 
        data: content 
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

// List Skills Schema
const listInputSchema = z.object({})

/** List Skills Tool 定义 */
export const listSkillsTool: ToolDefinition = {
  name: 'list_skills',
  description: 'List all available user-defined skills. Returns skill names and descriptions.',
  inputSchema: listInputSchema,
  permissions: ['skill'],
  
  async executor(_args: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    try {
      // 加载或使用缓存的 Skills
      if (!cachedSkills) {
        const skillsDir = getDefaultSkillsDir()
        const result = await loadSkills(skillsDir)
        cachedSkills = result.skills
      }
      
      if (cachedSkills.length === 0) {
        return { 
          success: true, 
          data: 'No skills available. Skills can be added to ~/.openvia/skills/' 
        }
      }
      
      logger.info(`Listing ${cachedSkills.length} available skills`)
      
      const skillList = cachedSkills.map(s => 
        `- ${s.id}: ${s.metadata.name}${s.metadata.description ? ` - ${s.metadata.description}` : ''}`
      ).join('\n')
      
      return { 
        success: true, 
        data: `Available skills:\n${skillList}` 
      }
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

/** 刷新 Skills 缓存 */
export function refreshSkillsCache(): void {
  cachedSkills = null
  logger.debug('Skills cache cleared')
}
