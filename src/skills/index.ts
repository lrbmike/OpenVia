/**
 * Skills Module - Agent Skills 加载和管理
 * 
 * Agent Skills 是用户定义的知识/工作流扩展
 * 存放在 ~/.openvia/skills/ 目录
 */

export {
  loadSkills,
  formatSkillsForPrompt,
  getDefaultSkillsDir,
  syncProjectSkillsToGlobal,
  type SkillMetadata,
  type LoadedSkill,
  type SkillsLoadResult
} from './loader'
