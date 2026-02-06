/**
 * Read Tool - 读取文件内容
 */

import { z } from 'zod'
import { readFile, stat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'

/** 参数 Schema */
const inputSchema = z.object({
  path: z.string().describe('The file path to read'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('File encoding (default: utf8)')
})

/** Read Tool 定义 */
export const readTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content as a string.',
  inputSchema,
  permissions: ['read'],
  
  async executor(args: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
    }
    
    const { path: filePath, encoding = 'utf8' } = parsed.data
    
    // 解析路径
    const absolutePath = isAbsolute(filePath) ? filePath : join(ctx.workDir, filePath)
    
    try {
      // 检查文件是否存在
      const stats = await stat(absolutePath)
      
      if (!stats.isFile()) {
        return { success: false, error: `Not a file: ${absolutePath}` }
      }
      
      // 限制文件大小（10MB）
      if (stats.size > 10 * 1024 * 1024) {
        return { success: false, error: `File too large (${stats.size} bytes). Max: 10MB` }
      }
      
      // 读取文件
      const content = await readFile(absolutePath, encoding as BufferEncoding)
      
      console.log(`[Read] Read file: ${absolutePath} (${stats.size} bytes)`)
      
      return {
        success: true,
        data: {
          path: absolutePath,
          size: stats.size,
          content
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
