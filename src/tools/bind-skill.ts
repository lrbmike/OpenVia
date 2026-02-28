import type { ToolDefinition } from '../core/registry'
import { Logger } from '../utils/logger'
import { bindSkillToGoal, getSkillScope } from '../skills/registry'

const logger = new Logger('BindSkillTool')

export const bindSkillTool: ToolDefinition = {
  name: 'bind_skill',
  description: 'Bind an installed capability (skill) to your current Goal context. Use this immediately after successfully installing a new skill via `npx skills add` to make it accessible to your current task scope.',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'The ID (folder name) of the skill you just installed (e.g., "postgres", "vercel-react-best-practices").'
      },
      goal_id: {
        type: 'string',
        description: 'Your current Goal ID (provided in your system context/prompt).'
      }
    },
    required: ['skill_id', 'goal_id']
  },
  executor: async (args: any) => {
    try {
      const { skill_id, goal_id } = args

      if (!skill_id || !goal_id) {
        return { success: false, content: 'Error: Missing required parameters skill_id or goal_id' }
      }

      // 验证此技能是否已被收录
      const scope = getSkillScope(skill_id)
      if (scope !== 'task' && scope !== 'persistent' && scope !== 'core') {
        // 如果还未被 loadSkills 自动收录（刚下载还没热补足），先当作合法并绑定
      }

      // 执行 SQLite 绑定关系写入
      bindSkillToGoal(skill_id, goal_id)
      
      logger.info(`Agent successfully bound skill ${skill_id} to goal ${goal_id} via tool.`)

      return { success: true, content: `Successfully bound skill "${skill_id}" to the current active Goal context: ${goal_id}. The skill will be available in your next agent execution step.` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to bind skill: ${msg}`)
      return { success: false, content: `Error binding skill: ${msg}`, isError: true }
    }
  }
}
