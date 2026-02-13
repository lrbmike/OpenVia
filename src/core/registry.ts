/**
 * Tool Registry - 宸ュ叿娉ㄥ唽涓績
 * 
 * 璐熻矗锛?
 * - 娉ㄥ唽绯荤粺鏀寔鐨勬墍鏈夊伐鍏?
 * - 鎻愪緵 tool schema 缁欐ā鍨?
 * - 鎻愪緵 executor 缁欐墽琛屽眰
 */

import { z } from 'zod'
import type { ToolSchema } from '../llm/adapter'
import { Logger } from '../utils/logger'

const logger = new Logger('ToolRegistry')

// ============================================================================
// 绫诲瀷瀹氫箟
// ============================================================================

/** 宸ュ叿鎵ц缁撴灉 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

/** 鎵ц涓婁笅鏂?*/
export interface ExecutionContext {
  userId: string
  chatId: string
  workDir: string
}

/** 宸ュ叿瀹氫箟 */
export interface ToolDefinition {
  /** 宸ュ叿鍚嶇О */
  name: string
  /** 宸ュ叿鎻忚堪 */
  description: string
  /** 杈撳叆鍙傛暟 Schema锛圸od锛?*/
  inputSchema: z.ZodType<unknown>
  /** 鎵€闇€鏉冮檺鏍囩 */
  permissions: string[]
  /** 鎵ц鍑芥暟 */
  executor: (args: unknown, ctx: ExecutionContext) => Promise<ToolResult>
}

// ============================================================================
// Tool Registry 瀹炵幇
// ============================================================================

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()
  
  /**
   * 娉ㄥ唽宸ュ叿
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`[ToolRegistry] Tool "${tool.name}" already registered, overwriting`)
    }
    this.tools.set(tool.name, tool)
    logger.info(`[ToolRegistry] Registered tool: ${tool.name}`)
  }
  
  /**
   * 鎵归噺娉ㄥ唽宸ュ叿
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }
  
  /**
   * 鑾峰彇宸ュ叿瀹氫箟
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }
  
  /**
   * 鑾峰彇鎵€鏈夊伐鍏峰悕绉?
   */
  getNames(): string[] {
    return Array.from(this.tools.keys())
  }
  
  /**
   * 鑾峰彇鎵€鏈夊伐鍏风殑 Schema锛堢粰 LLM 鐪嬶級
   */
  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.zodToJsonSchema(tool.inputSchema)
    }))
  }
  
  /**
   * 楠岃瘉宸ュ叿鍙傛暟
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
   * 灏?Zod schema 杞崲涓?JSON Schema锛堢畝鍖栫増锛?
   */
  private zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
    // 浣跨敤 Zod 鐨勫唴缃柟娉曡幏鍙?shape锛堝鏋滄湁锛?
    // 杩欓噷鏄竴涓畝鍖栧疄鐜帮紝瀹為檯鍙娇鐢?zod-to-json-schema 搴?
    const def = (schema as z.ZodObject<z.ZodRawShape>)._def
    
    if (def && 'shape' in def && typeof def.shape === 'function') {
      const shape = def.shape()
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      
      for (const [key, value] of Object.entries(shape)) {
        const fieldDef = (value as z.ZodTypeAny)._def
        let type = 'string'
        let description = ''
        
        // 鑾峰彇鎻忚堪
        if (fieldDef.description) {
          description = fieldDef.description
        }
        
        // 鍒ゆ柇绫诲瀷
        if (fieldDef.typeName === 'ZodString') type = 'string'
        else if (fieldDef.typeName === 'ZodNumber') type = 'number'
        else if (fieldDef.typeName === 'ZodBoolean') type = 'boolean'
        else if (fieldDef.typeName === 'ZodArray') type = 'array'
        else if (fieldDef.typeName === 'ZodObject') type = 'object'
        
        properties[key] = { type, description }
        
        // 妫€鏌ユ槸鍚﹀彲閫?
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
    
    // 榛樿杩斿洖绌?object schema
    return { type: 'object', properties: {} }
  }
}

// 鍗曚緥
let registryInstance: ToolRegistry | null = null

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry()
  }
  return registryInstance
}

