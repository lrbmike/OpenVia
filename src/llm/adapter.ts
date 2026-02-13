/**
 * LLM Adapter - unified model interface
 *
 * Supports three API formats: OpenAI / Claude / Gemini.
 * Configure format + apiKey + baseUrl + model to use a compatible model.
 */

import type { Message } from '../types'

// ============================================================================
// Core Types
// ============================================================================

/** Supported API formats */
export type LLMFormat = 'openai' | 'claude' | 'gemini'

/** Token usage stats */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** LLM event stream */
export type LLMEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown; meta?: Record<string, unknown> }
  | { type: 'tool_call_delta'; id: string; name?: string; argsFragment?: string }
  | { type: 'done'; usage?: TokenUsage; responseId?: string }
  | { type: 'error'; message: string }

/** Tool schema (shared JSON Schema) */
export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>  // JSON Schema
}

/** Tool call result (sent back to model) */
export interface ToolResult {
  toolCallId: string
  toolName?: string
  toolArgs?: unknown
  toolCallMeta?: Record<string, unknown>
  content: string
  isError?: boolean
}

// ============================================================================
// LLM Adapter Interface
// ============================================================================

/** LLM adapter config */
export interface LLMConfig {
  format: LLMFormat
  apiKey: string
  baseUrl: string
  model: string
  timeout?: number
  maxTokens?: number
  temperature?: number
}

/** LLM adapter interface */
export interface LLMAdapter {
  /** Send a chat request and return an event stream */
  chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
    previousResponseId?: string
  }): AsyncGenerator<LLMEvent>
  
  /** Adapter name */
  readonly name: string
  
  /** Model name */
  readonly model: string
  
  /** Max context tokens (estimated) */
  readonly maxContextTokens: number
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an LLM adapter from config.
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
