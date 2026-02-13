/**
 * Write Tool - write file contents
 */

import { z } from 'zod'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, isAbsolute, dirname } from 'node:path'
import type { ToolDefinition, ToolResult, ExecutionContext } from '../core/registry'
import { Logger } from '../utils/logger'

const logger = new Logger('Tool:Write')

/** Input schema */
const inputSchema = z.object({
  path: z.string().describe('The file path to write'),
  content: z.string().describe('The content to write to the file'),
  createDirs: z.boolean().optional().describe('Create parent directories if they do not exist (default: true)')
})

/** Write tool definition */
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
    
    // Resolve path.
    const absolutePath = isAbsolute(filePath) ? filePath : join(ctx.workDir, filePath)
    
    try {
      // Create parent directories.
      if (createDirs) {
        await mkdir(dirname(absolutePath), { recursive: true })
      }
      
      // Write file.
      await writeFile(absolutePath, content, 'utf8')
      
      logger.info(`[Write] Wrote file: ${absolutePath} (${content.length} bytes)`)
      
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


