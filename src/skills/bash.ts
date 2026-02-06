/**
 * Bash Skill - 执行 Shell 命令
 */

import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'

const execAsync = promisify(exec)

/** 参数 Schema */
const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)')
})

/** Bash Skill 定义 */
export const bashSkill: ToolDefinition = {
  name: 'bash',
  description: 'Execute a shell command and return the output. Use this for running scripts, installing packages, file operations, etc.',
  inputSchema,
  permissions: ['shell'],
  
  async executor(args: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
    }
    
    const { command, timeout = 30000 } = parsed.data
    
    try {
      console.log(`[Bash] Executing: ${command.slice(0, 100)}...`)
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.workDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      })
      
      const output = stdout + (stderr ? `\n[stderr]: ${stderr}` : '')
      
      return {
        success: true,
        data: output.trim()
      }
    } catch (error) {
      const err = error as { message: string; code?: number; signal?: string; stdout?: string; stderr?: string }
      
      // 命令执行失败但有输出
      if (err.stdout || err.stderr) {
        return {
          success: false,
          error: `Command failed with exit code ${err.code || 'unknown'}`,
          data: {
            stdout: err.stdout,
            stderr: err.stderr
          }
        }
      }
      
      return {
        success: false,
        error: err.message
      }
    }
  }
}
