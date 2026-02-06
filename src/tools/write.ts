/**
 * Write Tool - 写入文件内容
 */

import { z } from 'zod'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, isAbsolute, dirname } from 'node:path'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'

/** 参数 Schema */
const inputSchema = z.object({
  path: z.string().describe('The file path to write'),
  content: z.string().describe('The content to write to the file'),
  createDirs: z.boolean().optional().describe('Create parent directories if they do not exist (default: true)')
})

/** Write Tool 定义 */
export const writeTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist, or overwrites it if it does.',
  inputSchema,
  permissions: ['write'],
  
  async executor(args: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
    }
    
    const { path: filePath, content, createDirs = true } = parsed.data
    
    // 解析路径
    const absolutePath = isAbsolute(filePath) ? filePath : join(ctx.workDir, filePath)
    
    try {
      // 创建父目录
      if (createDirs) {
        await mkdir(dirname(absolutePath), { recursive: true })
      }
      
      // 写入文件
      await writeFile(absolutePath, content, 'utf8')
      
      console.log(`[Write] Wrote file: ${absolutePath} (${content.length} bytes)`)
      
      return {
        success: true,
        data: {
          path: absolutePath,
          size: content.length
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
