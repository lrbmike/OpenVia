/**
 * LLM Adapter - 统一模型接口定义
 * 
 * 支持三种 API 格式：OpenAI / Claude / Gemini
 * 用户只需配置 format + apiKey + baseUrl + model 即可使用任意兼容模型
 */

import type { Message } from '../types'

// ============================================================================
// 核心类型定义
// ============================================================================

/** 支持的 API 格式 */
export type LLMFormat = 'openai' | 'claude' | 'gemini'

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** LLM 事件流 */
export type LLMEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_call_delta'; id: string; name?: string; argsFragment?: string }
  | { type: 'done'; usage?: TokenUsage }
  | { type: 'error'; message: string }

/** Tool Schema - JSON Schema 格式（三家通用） */
export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>  // JSON Schema
}

/** Tool 调用结果（回传给模型） */
export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}

// ============================================================================
// LLM Adapter 接口
// ============================================================================

/** LLM 适配器配置 */
export interface LLMConfig {
  format: LLMFormat
  apiKey: string
  baseUrl: string
  model: string
  timeout?: number
  maxTokens?: number
  temperature?: number
}

/** LLM 适配器接口 */
export interface LLMAdapter {
  /** 发送对话请求，返回事件流 */
  chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent>
  
  /** 适配器名称 */
  readonly name: string
  
  /** 模型名称 */
  readonly model: string
  
  /** 最大上下文 token 数（估算） */
  readonly maxContextTokens: number
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 根据配置创建对应的 LLM 适配器
 */
export async function createLLMAdapter(config: LLMConfig): Promise<LLMAdapter> {
  switch (config.format) {
    case 'openai': {
      const { OpenAIFormatAdapter } = await import('./openai-format')
      return new OpenAIFormatAdapter(config)
    }
    case 'claude': {
      const { ClaudeFormatAdapter } = await import('./claude-format')
      return new ClaudeFormatAdapter(config)
    }
    case 'gemini': {
      const { GeminiFormatAdapter } = await import('./gemini-format')
      return new GeminiFormatAdapter(config)
    }
    default:
      throw new Error(`Unsupported LLM format: ${config.format}`)
  }
}
