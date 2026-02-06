/**
 * OpenAI Format Adapter
 * 
 * 兼容所有使用 OpenAI API 格式的模型：
 * - OpenAI (GPT-4, GPT-4o, etc.)
 * - Qwen (通义千问)
 * - DeepSeek
 * - Moonshot
 * - Ollama (本地模型)
 * - 其他 OpenAI 兼容 API
 */

import type { Message } from '../types'
import type { 
  LLMAdapter, 
  LLMConfig, 
  LLMEvent, 
  ToolSchema, 
  ToolResult,
  TokenUsage 
} from './adapter'

// ============================================================================
// OpenAI API 类型定义
// ============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIStreamChoice {
  index: number
  delta: {
    role?: string
    content?: string | null
    tool_calls?: Array<{
      index: number
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
  finish_reason: string | null
}

interface OpenAIStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: OpenAIStreamChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ============================================================================
// OpenAI Format Adapter 实现
// ============================================================================

export class OpenAIFormatAdapter implements LLMAdapter {
  readonly name = 'openai-format'
  readonly model: string
  readonly maxContextTokens: number
  
  private config: LLMConfig
  
  constructor(config: LLMConfig) {
    this.config = config
    this.model = config.model
    // 根据模型名估算上下文长度
    this.maxContextTokens = this.estimateContextLength(config.model)
  }
  
  private estimateContextLength(model: string): number {
    // 常见模型的上下文长度
    if (model.includes('gpt-4o')) return 128000
    if (model.includes('gpt-4-turbo')) return 128000
    if (model.includes('gpt-4')) return 8192
    if (model.includes('gpt-3.5')) return 16384
    if (model.includes('qwen-max')) return 32000
    if (model.includes('qwen-plus')) return 131072
    if (model.includes('qwen-turbo')) return 131072
    if (model.includes('deepseek')) return 64000
    if (model.includes('moonshot')) return 128000
    // 默认
    return 8192
  }
  
  async *chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // 构建 OpenAI 格式的消息
    const openaiMessages: OpenAIMessage[] = []
    
    // System prompt
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt })
    }
    
    // 转换消息历史
    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })
    }
    
    // 添加 tool results（如果有）
    if (toolResults && toolResults.length > 0) {
      for (const result of toolResults) {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.content
        })
      }
    }
    
    // 构建 tools
    const openaiTools: OpenAITool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }))
    
    // 发起请求
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`
    
    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true }
    }
    
    if (openaiTools && openaiTools.length > 0) {
      body.tools = openaiTools
    }
    
    if (this.config.maxTokens) {
      body.max_tokens = this.config.maxTokens
    }
    
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature
    }
    
    const controller = new AbortController()
    const timeout = this.config.timeout || 120000
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const errorText = await response.text()
        yield { type: 'error', message: `API error ${response.status}: ${errorText}` }
        return
      }
      
      if (!response.body) {
        yield { type: 'error', message: 'No response body' }
        return
      }
      
      // 解析 SSE 流
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      // 用于累积 tool_calls
      const pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map()
      let usage: TokenUsage | undefined
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue
          
          const jsonStr = trimmed.slice(6)
          try {
            const chunk: OpenAIStreamChunk = JSON.parse(jsonStr)
            
            // 提取 usage
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens
              }
            }
            
            for (const choice of chunk.choices) {
              const delta = choice.delta
              
              // 文本内容
              if (delta.content) {
                yield { type: 'text_delta', content: delta.content }
              }
              
              // Tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index
                  
                  if (!pendingToolCalls.has(idx)) {
                    pendingToolCalls.set(idx, { id: '', name: '', args: '' })
                  }
                  
                  const pending = pendingToolCalls.get(idx)!
                  
                  if (tc.id) pending.id = tc.id
                  if (tc.function?.name) pending.name = tc.function.name
                  if (tc.function?.arguments) {
                    pending.args += tc.function.arguments
                    
                    // 发送增量事件
                    yield {
                      type: 'tool_call_delta',
                      id: pending.id,
                      name: pending.name || undefined,
                      argsFragment: tc.function.arguments
                    }
                  }
                }
              }
              
              // 完成时发送完整的 tool_call 事件
              if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                for (const [, tc] of pendingToolCalls) {
                  if (tc.id && tc.name) {
                    try {
                      const args = tc.args ? JSON.parse(tc.args) : {}
                      yield { type: 'tool_call', id: tc.id, name: tc.name, args }
                    } catch {
                      yield { type: 'error', message: `Failed to parse tool args: ${tc.args}` }
                    }
                  }
                }
                pendingToolCalls.clear()
              }
            }
          } catch (e) {
            // 忽略解析错误，继续处理
            console.debug('[OpenAI] Failed to parse chunk:', jsonStr, e)
          }
        }
      }
      
      yield { type: 'done', usage }
      
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          yield { type: 'error', message: 'Request timeout' }
        } else {
          yield { type: 'error', message: error.message }
        }
      } else {
        yield { type: 'error', message: String(error) }
      }
    }
  }
}
