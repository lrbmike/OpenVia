/**
 * Skills Loader - 从用户目录加载 Agent Skills
 * 
 * Agent Skills 是用户定义的知识/工作流扩展
 * 存放在 ~/.openvia/skills/ 目录
 * 
 * Skill 目录结构：
 * my-skill/
 * ├── SKILL.md      # 必需：指令 + 元数据
 * ├── scripts/      # 可选：可执行脚本
 * ├── references/   # 可选：参考文档
 * └── assets/       # 可选：模板资源
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Logger } from '../utils/logger'
import { getSkillScope, registerInstalledSkill } from './registry'

const logger = new Logger('SkillsLoader')

// ============================================================================
// 初始化逻辑
// ============================================================================

/**
 * 将项目自带的内置技能（如 web-search / find-skills）同步至全局技能存储区
 * 只有当全局区尚未具备该技能时才会进行拷贝（避免覆盖用户的修改）
 */
export async function syncProjectSkillsToGlobal(): Promise<void> {
  try {
    const projectSkillsDir = path.join(process.cwd(), 'skills')
    const globalSkillsDir = getDefaultSkillsDir()
    
    // 确保项目技能目录确实存在
    const stats = await fs.stat(projectSkillsDir).catch(() => null)
    if (!stats || !stats.isDirectory()) return

    // 确保全局目标目录存在
    await fs.mkdir(globalSkillsDir, { recursive: true }).catch(() => {})

    const entries = await fs.readdir(projectSkillsDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
        
      const sourcePath = path.join(projectSkillsDir, entry.name)
      const destPath = path.join(globalSkillsDir, entry.name)
      
      const destExists = await fs.stat(destPath).catch(() => null)
      if (!destExists) {
        logger.info(`Syncing built-in skill: ${entry.name}`)
        await fs.cp(sourcePath, destPath, { recursive: true })
      }
    }
  } catch (err) {
    logger.error(`Failed to sync built-in skills: ${err}`)
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/** Skill 元数据 */
export interface SkillMetadata {
  name: string
  description: string
  version?: string
  author?: string
  tags?: string[]
  // scope 从 sqlite registry 中动态获悉，文件内的作为回退
  scope?: 'core' | 'task' | 'persistent'
  bound_goal_id?: string
}

/** 加载的 Skill */
export interface LoadedSkill {
  id: string           // 目录名
  metadata: SkillMetadata
  instructions: string // SKILL.md 内容
  path: string         // 完整路径
}

/** Skills 加载结果 */
export interface SkillsLoadResult {
  skills: LoadedSkill[]
  errors: string[]
}

// ============================================================================
// Skills 加载器
// ============================================================================

/**
 * 从指定目录加载所有 Skills
 */
export async function loadSkills(skillsDir: string): Promise<SkillsLoadResult> {
  const skills: LoadedSkill[] = []
  const errors: string[] = []
  
  try {
    // 检查目录是否存在
    const stat = await fs.stat(skillsDir).catch(() => null)
    if (!stat?.isDirectory()) {
      logger.debug(`Skills directory not found: ${skillsDir}`)
      return { skills: [], errors: [] }
    }
    
    // 读取所有子目录
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const skillPath = path.join(skillsDir, entry.name)
      const skillMdPath = path.join(skillPath, 'SKILL.md')
      
      try {
        // 检查 SKILL.md 是否存在
        const skillMdStat = await fs.stat(skillMdPath).catch(() => null)
        if (!skillMdStat?.isFile()) {
          logger.debug(`Skipping ${entry.name}: no SKILL.md found`)
          continue
        }
        
        // 读取 SKILL.md
        const content = await fs.readFile(skillMdPath, 'utf-8')
        
        // 解析元数据和指令
        const { metadata, instructions } = parseSkillMd(content, entry.name)
        
        // SQLite Registry: 如果该技能还未被登记进 SQL，将其登记
        // 首先从 SQL 获取它之前的强制 scope；如果 SQL 里没有，才用 YAML 里解析的
        const recordScope = getSkillScope(entry.name) // 获取注册表值，这可能没找到所以默认为 persistent
        if (!recordScope || recordScope === 'persistent') {
           // 若为空或默认值，登记当前实际的 metadata.scope 进去，以便以后持久化
           registerInstalledSkill(entry.name, metadata.name, metadata.description, metadata.scope || 'persistent')
        } 
        
        // 最终决定它的 scope: SQLite优先 > YAML覆盖 > persistent默认
        metadata.scope = recordScope !== 'persistent' ? recordScope : (metadata.scope || 'persistent')
        
        skills.push({
          id: entry.name,
          metadata,
          instructions,
          path: skillPath
        })
        
        logger.info(`Loaded skill: ${metadata.name} (${entry.name}) [scope=${metadata.scope}]`)
        
      } catch (err) {
        const message = `Failed to load skill ${entry.name}: ${err}`
        errors.push(message)
        logger.warn(message)
      }
    }
    
    logger.info(`Loaded ${skills.length} skills from ${skillsDir}`)
    
  } catch (err) {
    const message = `Failed to read skills directory: ${err}`
    errors.push(message)
    logger.error(message)
  }
  
  return { skills, errors }
}

/**
 * 解析 SKILL.md 内容
 * 
 * 格式：
 * ---
 * name: Skill Name
 * description: What this skill does
 * scope: core | task | persistent (optional, fallback from db metadata)
 * ---
 * 
 * # Instructions
 * ...
 */
function parseSkillMd(content: string, fallbackName: string): { 
  metadata: SkillMetadata
  instructions: string 
} {
  // 默认元数据
  let metadata: SkillMetadata = {
    name: fallbackName,
    description: '',
    scope: 'persistent' // 默认作为持久能力
  }
  
  let instructions = content
  
  // 尝试解析 YAML frontmatter
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    instructions = frontmatterMatch[2].trim()
    
    // 简单的 YAML 解析
    const lines = frontmatter.split(/\r?\n/)
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      
      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()
      
      switch (key) {
        case 'name':
          metadata.name = value
          break
        case 'description':
          metadata.description = value
          break
        case 'version':
          metadata.version = value
          break
        case 'author':
          metadata.author = value
          break
        case 'tags':
          // 处理形如 [tag1, tag2] 的格式
          let tagsStr = value
          if (tagsStr.startsWith('[') && tagsStr.endsWith(']')) {
            tagsStr = tagsStr.slice(1, -1)
          }
          metadata.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean)
          break
        case 'scope':
          metadata.scope = value as 'core' | 'task' | 'persistent'
          break
        case 'bound_goal_id':
          metadata.bound_goal_id = value
          break
      }
    }
  }
  
  return { metadata, instructions }
}

/**
 * 将加载的 Skills 格式化为 System Prompt 扩展
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return ''
  
  const parts = ['## Available Skills\n']
  
  for (const skill of skills) {
    parts.push(`### ${skill.metadata.name}`)
    if (skill.metadata.description) {
      parts.push(`> ${skill.metadata.description}`)
    }
    parts.push('')
    parts.push(skill.instructions)
    parts.push('')
  }
  
  return parts.join('\n')
}

/**
 * 获取默认的 Skills 目录
 */
export function getDefaultSkillsDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(homeDir, '.openvia', 'skills')
}
