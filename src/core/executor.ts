/**
 * Tool Executor - 宸ュ叿鎵ц灞?
 * 
 * 璐熻矗锛?
 * - 鎵ц宸茶 Policy 鎵瑰噯鐨勫伐鍏?
 * - 鍙傛暟鏍￠獙锛堜娇鐢?Zod锛?
 * - 杩斿洖缁撴瀯鍖栫粨鏋?
 * 
 * 鍘熷垯锛?
 * - 绾墽琛屽崟鍏冿紝涓嶅仛鏉冮檺鍒ゆ柇
 * - Executor 涓嶇煡閬?鐢ㄦ埛鏄皝"
 */

import type { ToolRegistry, ToolResult, ExecutionContext } from './registry'
import { Logger } from '../utils/logger'

const logger = new Logger('Executor')

// ============================================================================
// Executor 瀹炵幇
// ============================================================================

export class ToolExecutor {
  private registry: ToolRegistry
  
  constructor(registry: ToolRegistry) {
    this.registry = registry
  }
  
  /**
   * 鎵ц宸ュ叿
   */
  async execute(input: {
    toolName: string
    args: unknown
    context: ExecutionContext
  }): Promise<ToolResult> {
    const { toolName, args, context } = input
    
    // 1. 鑾峰彇宸ュ叿瀹氫箟
    const tool = this.registry.get(toolName)
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`
      }
    }
    
    // 2. 鍙傛暟鏍￠獙
    const validation = this.registry.validateArgs(toolName, args)
    if (!validation.success) {
      return {
        success: false,
        error: `Invalid arguments: ${validation.error}`
      }
    }
    
    // 3. 鎵ц
    try {
      logger.info(`[Executor] Executing tool: ${toolName}`)
      const startTime = Date.now()
      
      const result = await tool.executor(validation.data, context)
      
      const duration = Date.now() - startTime
      logger.info(`[Executor] Tool ${toolName} completed in ${duration}ms`)
      
      return result
    } catch (error) {
      logger.error(`[Executor] Tool ${toolName} failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

