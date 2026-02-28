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

/**
 * 将 Skills CLI 默认安装目录（~/.agents/skills）中的技能镜像到 OpenVia 目录（~/.openvia/skills）
 * 仅拷贝缺失目录，不覆盖已存在目录。
 */
export async function syncAgentsSkillsToOpenVia(): Promise<void> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    const agentsSkillsDir = path.join(homeDir, '.agents', 'skills')
    const openviaSkillsDir = getDefaultSkillsDir()

    const agentsStat = await fs.stat(agentsSkillsDir).catch(() => null)
    if (!agentsStat?.isDirectory()) return

    await fs.mkdir(openviaSkillsDir, { recursive: true }).catch(() => {})
    const entries = await fs.readdir(agentsSkillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const src = path.join(agentsSkillsDir, entry.name)
      const dst = path.join(openviaSkillsDir, entry.name)
      const exists = await fs.stat(dst).catch(() => null)
      if (!exists) {
        await fs.cp(src, dst, { recursive: true })
        logger.info(`Mirrored skill from .agents to .openvia: ${entry.name}`)
      }
    }
  } catch (err) {
    logger.warn(`Failed to sync .agents skills to .openvia: ${err}`)
  }
}

/**
 * 仅同步单个技能目录（用于 npx skills add 成功后的即时热同步）
 */
export async function syncSingleAgentSkillToOpenVia(skillId: string): Promise<void> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    const src = path.join(homeDir, '.agents', 'skills', skillId)
    const dstRoot = getDefaultSkillsDir()
    const dst = path.join(dstRoot, skillId)

    const srcStat = await fs.stat(src).catch(() => null)
    if (!srcStat?.isDirectory()) return

    await fs.mkdir(dstRoot, { recursive: true }).catch(() => {})
    await fs.rm(dst, { recursive: true, force: true }).catch(() => {})
    await fs.cp(src, dst, { recursive: true })
    logger.info(`Mirrored newly installed skill to .openvia: ${skillId}`)
  } catch (err) {
    logger.warn(`Failed to mirror installed skill "${skillId}" to .openvia: ${err}`)
  }
}

// ============================================================================
// Skills 加载器
// ============================================================================

/**
 * 从指定目录加载所有 Skills
 */
export async function loadSkills(skillsDir: string | string[]): Promise<SkillsLoadResult> {
  const dirs = Array.isArray(skillsDir) ? skillsDir : [skillsDir]
  const skills: LoadedSkill[] = []
  const errors: string[] = []
  const byId = new Map<string, LoadedSkill>()
  
  for (const dir of dirs) {
    try {
      // 检查目录是否存在
      const stat = await fs.stat(dir).catch(() => null)
      if (!stat?.isDirectory()) {
        logger.debug(`Skills directory not found: ${dir}`)
        continue
      }
      
      // 读取所有子目录
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        
        const skillPath = path.join(dir, entry.name)
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
          
          // SQLite Registry: 保持技能元信息可追踪
          const recordScope = getSkillScope(entry.name)
          if (!recordScope || recordScope === 'persistent') {
            registerInstalledSkill(entry.name, metadata.name, metadata.description, metadata.scope || 'persistent')
          } 
          
          // 最终 scope: SQLite 优先 > YAML > persistent
          metadata.scope = recordScope !== 'persistent' ? recordScope : (metadata.scope || 'persistent')
          
          const loaded: LoadedSkill = {
            id: entry.name,
            metadata,
            instructions,
            path: skillPath
          }

          // 目录优先级：前面的目录优先（通常仅使用 .openvia）
          if (!byId.has(entry.name)) {
            byId.set(entry.name, loaded)
            logger.info(`Loaded skill: ${metadata.name} (${entry.name}) [scope=${metadata.scope}] from ${dir}`)
          }
          
        } catch (err) {
          const message = `Failed to load skill ${entry.name}: ${err}`
          errors.push(message)
          logger.warn(message)
        }
      }
    } catch (err) {
      const message = `Failed to read skills directory ${dir}: ${err}`
      errors.push(message)
      logger.error(message)
    }
  }

  skills.push(...byId.values())
  logger.info(`Loaded ${skills.length} skills from [${dirs.join(', ')}]`)
  
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
    parts.push(`> Skill ID: ${skill.id}`)
    parts.push(`> Skill Root Path (canonical): ${skill.path.replace(/\\/g, '/')}`)
    parts.push('> Path rule: when calling bash with skill scripts, always use forward slashes and quote full path.')
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
