import { z } from 'zod'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'
import { Logger } from '../utils/logger'
import { bindSkillToGoal, getSkillScope } from '../skills/registry'

const logger = new Logger('BindSkillTool')

const inputSchema = z.object({
  skill_id: z.string().describe('The ID (folder name) of the skill you just installed (e.g., "postgres", "vercel-react-best-practices").'),
  goal_id: z.string().describe('Your current Goal ID (provided in your system context/prompt).')
})

export const bindSkillTool: ToolDefinition = {
  name: 'bind_skill',
  description: 'Bind an installed capability (skill) to your current Goal context. Use this immediately after successfully installing a new skill via `npx skills add` to make it accessible to your current task scope.',
  inputSchema,
  permissions: ['skill'],
  executor: async (args: unknown, _ctx?: ExecutionContext): Promise<ToolResult> => {
    try {
      const parsed = inputSchema.safeParse(args)
      if (!parsed.success) {
        return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
      }
      
      const { skill_id, goal_id } = parsed.data

      if (!skill_id || !goal_id) {
        return { success: false, error: 'Missing required parameters skill_id or goal_id' }
      }

      // 验证此技能是否已被收录
      const scope = getSkillScope(skill_id)
      if (scope !== 'task' && scope !== 'persistent' && scope !== 'core') {
        // 如果还未被 loadSkills 自动收录（刚下载还没热补足），先当作合法并绑定
      }

      // 执行 SQLite 绑定关系写入
      bindSkillToGoal(skill_id, goal_id)
      
      logger.info(`Agent successfully bound skill ${skill_id} to goal ${goal_id} via tool.`)

      return { success: true, data: `Successfully bound skill "${skill_id}" to the current active Goal context: ${goal_id}. The skill will be available in your next agent execution step.` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to bind skill: ${msg}`)
      return { success: false, error: `Error binding skill: ${msg}` }
    }
  }
}
