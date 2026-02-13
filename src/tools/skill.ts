/**
 * Skill Tool - read user-defined Agent Skills
 *
 * Allows the LLM to call skills explicitly for observable skill usage.
 */

import { z } from 'zod'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'
import { loadSkills, getDefaultSkillsDir, type LoadedSkill } from '../skills'
import { Logger } from '../utils/logger'

const logger = new Logger('SkillTool')

// Cache loaded skills.
let cachedSkills: LoadedSkill[] | null = null

const inputSchema = z.object({
  name: z.string().describe('Name of the skill to read (directory name)')
})

/** Read skill tool definition */
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
      // Load or use cached skills.
      if (!cachedSkills) {
        const skillsDir = getDefaultSkillsDir()
        const result = await loadSkills(skillsDir)
        cachedSkills = result.skills
      }
      
      // Find the requested skill.
      const skill = cachedSkills.find(s => s.id === name || s.metadata.name === name)
      
      if (!skill) {
        const availableSkills = cachedSkills.map(s => s.id).join(', ')
        return { 
          success: false, 
          error: `Skill "${name}" not found. Available skills: ${availableSkills || 'none'}` 
        }
      }
      
      logger.info(`Reading skill: ${skill.metadata.name} (${skill.id})`)
      
      // Return skill content.
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

/** List skills tool definition */
export const listSkillsTool: ToolDefinition = {
  name: 'list_skills',
  description: 'List all available user-defined skills. Returns skill names and descriptions.',
  inputSchema: listInputSchema,
  permissions: ['skill'],
  
  async executor(_args: unknown, _ctx: ExecutionContext): Promise<ToolResult> {
    try {
      // Load or use cached skills.
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

/** Clear the skills cache */
export function refreshSkillsCache(): void {
  cachedSkills = null
  logger.debug('Skills cache cleared')
}

