/**
 * Edit Tool - modify file contents (replace specific segments)
 */

import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'
import { Logger } from '../utils/logger'

const logger = new Logger('Tool:Edit')

/** Input schema */
const inputSchema = z.object({
  path: z.string().describe('The file path to edit'),
  oldContent: z.string().describe('The content to search for and replace'),
  newContent: z.string().describe('The new content to replace with'),
  replaceAll: z.boolean().optional().describe('Replace all occurrences (default: false, replace first only)')
})

/** Edit tool definition */
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
    
    // Resolve path.
    const absolutePath = isAbsolute(filePath) ? filePath : join(ctx.workDir, filePath)
    
    try {
      // Read file.
      const content = await readFile(absolutePath, 'utf8')
      
      // Ensure the target content exists.
      if (!content.includes(oldContent)) {
        return {
          success: false,
          error: `Content to replace not found in file: ${oldContent.slice(0, 50)}...`
        }
      }
      
      // Replace content.
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
      
      // Write file.
      await writeFile(absolutePath, newFileContent, 'utf8')
      
      logger.info(`[Edit] Edited file: ${absolutePath} (${count} replacement(s))`)
      
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

/** Escape regex special characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


