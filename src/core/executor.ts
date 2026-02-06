/**
 * Tool Executor - 工具执行层
 * 
 * 负责：
 * - 执行已被 Policy 批准的工具
 * - 参数校验（使用 Zod）
 * - 返回结构化结果
 * 
 * 原则：
 * - 纯执行单元，不做权限判断
 * - Executor 不知道"用户是谁"
 */

import type { ToolRegistry, ToolResult, ExecutionContext } from './registry'

// ============================================================================
// Executor 实现
// ============================================================================

export class ToolExecutor {
  private registry: ToolRegistry
  
  constructor(registry: ToolRegistry) {
    this.registry = registry
  }
  
  /**
   * 执行工具
   */
  async execute(input: {
    toolName: string
    args: unknown
    context: ExecutionContext
  }): Promise<ToolResult> {
    const { toolName, args, context } = input
    
    // 1. 获取工具定义
    const tool = this.registry.get(toolName)
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`
      }
    }
    
    // 2. 参数校验
    const validation = this.registry.validateArgs(toolName, args)
    if (!validation.success) {
      return {
        success: false,
        error: `Invalid arguments: ${validation.error}`
      }
    }
    
    // 3. 执行
    try {
      console.log(`[Executor] Executing tool: ${toolName}`)
      const startTime = Date.now()
      
      const result = await tool.executor(validation.data, context)
      
      const duration = Date.now() - startTime
      console.log(`[Executor] Tool ${toolName} completed in ${duration}ms`)
      
      return result
    } catch (error) {
      console.error(`[Executor] Tool ${toolName} failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
