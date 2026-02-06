/**
 * Edit Tool - 编辑文件内容（替换指定部分）
 */

import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'

/** 参数 Schema */
const inputSchema = z.object({
  path: z.string().describe('The file path to edit'),
  oldContent: z.string().describe('The content to search for and replace'),
  newContent: z.string().describe('The new content to replace with'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false, replace first only)')
})

/** Edit Tool 定义 */
export const editTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing specific content. Searches for oldContent and replaces it with newContent.',
  inputSchema,
  permissions: ['write'],
  
  async executor(args: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` }
    }
    
    const { path: filePath, oldContent, newContent, replaceAll = false } = parsed.data
    
    // 解析路径
    const absolutePath = isAbsolute(filePath) ? filePath : join(ctx.workDir, filePath)
    
    try {
      // 读取文件
      const content = await readFile(absolutePath, 'utf8')
      
      // 检查是否包含要替换的内容
      if (!content.includes(oldContent)) {
        return {
          success: false,
          error: `Content to replace not found in file: ${oldContent.slice(0, 50)}...`
        }
      }
      
      // 替换内容
      let newFileContent: string
      let count: number
      
      if (replaceAll) {
        const regex = new RegExp(escapeRegex(oldContent), 'g')
        const matches = content.match(regex)
        count = matches ? matches.length : 0
        newFileContent = content.replace(regex, newContent)
      } else {
        count = 1
        newFileContent = content.replace(oldContent, newContent)
      }
      
      // 写入文件
      await writeFile(absolutePath, newFileContent, 'utf8')
      
      console.log(`[Edit] Edited file: ${absolutePath} (${count} replacement(s))`)
      
      return {
        success: true,
        data: {
          path: absolutePath,
          replacements: count
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

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
