/**
 * Tool Registry - 工具注册中心
 * 
 * 负责：
 * - 注册系统支持的所有工具
 * - 提供 tool schema 给模型
 * - 提供 executor 给执行层
 */

import { z } from 'zod'
import type { ToolSchema } from '../llm/adapter'

// ============================================================================
// 类型定义
// ============================================================================

/** 工具执行结果 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

/** 执行上下文 */
export interface ExecutionContext {
  userId: string
  chatId: string
  workDir: string
}

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description: string
  /** 输入参数 Schema（Zod） */
  inputSchema: z.ZodType<unknown>
  /** 所需权限标签 */
  permissions: string[]
  /** 执行函数 */
  executor: (args: unknown, ctx: ExecutionContext) => Promise<ToolResult>
}

// ============================================================================
// Tool Registry 实现
// ============================================================================

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  
  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool "${tool.name}" already registered, overwriting`)
    }
    this.tools.set(tool.name, tool)
    console.log(`[ToolRegistry] Registered tool: ${tool.name}`)
  }
  
  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }
  
  /**
   * 获取工具定义
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }
  
  /**
   * 获取所有工具名称
   */
  getNames(): string[] {
    return Array.from(this.tools.keys())
  }
  
  /**
   * 获取所有工具的 Schema（给 LLM 看）
   */
  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.zodToJsonSchema(tool.inputSchema)
    }))
  }
  
  /**
   * 验证工具参数
   */
  validateArgs(name: string, args: unknown): { success: true; data: unknown } | { success: false; error: string } {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` }
    }
    
    const result = tool.inputSchema.safeParse(args)
    if (result.success) {
      return { success: true, data: result.data }
    } else {
      return { success: false, error: result.error.message }
    }
  }
  
  /**
   * 将 Zod schema 转换为 JSON Schema（简化版）
   */
  private zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
    // 使用 Zod 的内置方法获取 shape（如果有）
    // 这里是一个简化实现，实际可使用 zod-to-json-schema 库
    const def = (schema as z.ZodObject<z.ZodRawShape>)._def
    
    if (def && 'shape' in def && typeof def.shape === 'function') {
      const shape = def.shape()
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      
      for (const [key, value] of Object.entries(shape)) {
        const fieldDef = (value as z.ZodTypeAny)._def
        let type = 'string'
        let description = ''
        
        // 获取描述
        if (fieldDef.description) {
          description = fieldDef.description
        }
        
        // 判断类型
        if (fieldDef.typeName === 'ZodString') type = 'string'
        else if (fieldDef.typeName === 'ZodNumber') type = 'number'
        else if (fieldDef.typeName === 'ZodBoolean') type = 'boolean'
        else if (fieldDef.typeName === 'ZodArray') type = 'array'
        else if (fieldDef.typeName === 'ZodObject') type = 'object'
        
        properties[key] = { type, description }
        
        // 检查是否可选
        if (fieldDef.typeName !== 'ZodOptional' && !fieldDef.isOptional?.()) {
          required.push(key)
        }
      }
      
      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      }
    }
    
    // 默认返回空 object schema
    return { type: 'object', properties: {} }
  }
}

// 单例
let registryInstance: ToolRegistry | null = null

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry()
  }
  return registryInstance
}
