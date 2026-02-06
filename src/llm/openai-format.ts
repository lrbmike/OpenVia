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
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null
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
// Responses API Types (Phase 13)
// ============================================================================

interface ResponsesInputBlock {
  type: 'input_text' | 'input_image'
  text?: string
  image_url?: string
}

interface ResponsesInputItem {
  type: 'message'
  role: 'user' | 'system' | 'developer' | 'assistant'
  content: ResponsesInputBlock[]
}

interface ResponsesOutputBlock {
  type: 'output_text'
  text: string
}

interface ResponsesOutputItem {
  id: string
  type: 'message'
  role: 'assistant'
  content: ResponsesOutputBlock[]
}

interface ResponsesStreamEvent {
  output?: ResponsesOutputItem[]
  usage?: {
    input_tokens: number
    output_tokens: number
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
    // 转换消息历史
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      } else {
        // Structured content (ContentBlock[])
        const content = msg.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text }
          } else {
            // Image block
            return {
              type: 'image_url' as const,
              image_url: {
                url: `data:${block.mimeType};base64,${block.data}`
              }
            }
          }
        })
        
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant',
          content
        })
      }
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
    let url = this.config.baseUrl.replace(/\/$/, '')
    
    // Check for /responses mode (Phase 13)
    const isResponsesMode = url.endsWith('/responses')
    
    if (isResponsesMode) {
      // Delegate to new protocol handler
      yield* this.chatWithResponses(url, input)
      return
    }

    // Standard OpenAI mode
    if (!url.endsWith('/chat/completions')) {
      url += '/chat/completions'
    }
    
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
    
    // Debug logging
    // console.debug(`[OpenAI] Sending request to: ${url}`)
    // console.debug(`[OpenAI] Model: ${this.model}`)
    // console.debug(`[OpenAI] Body: ${JSON.stringify(body)}`) // Uncomment if needed, but reduce noise

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
      
      clearTimeout(timeoutId)
      
      // console.debug(`[OpenAI] Response status: ${response.status}`)
      
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

  /**
   * Handle /v1/responses protocol (Phase 13)
   * 
   * OpenAI Responses API 使用不同的请求格式：
   * - tools: 定义在顶层（与 Chat Completions 类似）
   * - input: 消息数组
   * - 事件类型: response.function_call_arguments.done
   */
  private async *chatWithResponses(url: string, input: {
      messages: Message[]
      tools?: ToolSchema[]
      systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
      const { messages, tools, systemPrompt } = input

      // 1. Map messages to ResponsesInput
      const inputItems: ResponsesInputItem[] = []
      
      // System prompt 使用 developer role（推荐）或 system role
      if (systemPrompt) {
          inputItems.push({
              type: 'message',
              role: 'developer',
              content: [{ type: 'input_text', text: systemPrompt }]
          })
      }

      for (const msg of messages) {
          // Responses API: user 消息用 user，assistant 历史记录暂不支持
          // 注意：Responses API 的 input 不直接支持 assistant 角色，历史消息需要特殊处理
          // 这里我们只处理 user 消息
          if (msg.role !== 'user') continue  // 跳过 assistant 消息
          
          const blocks: ResponsesInputBlock[] = []

          if (typeof msg.content === 'string') {
              blocks.push({ type: 'input_text', text: msg.content })
          } else {
              for (const block of msg.content) {
                  if (block.type === 'text') {
                      blocks.push({ type: 'input_text', text: block.text })
                  } else if (block.type === 'image') {
                      blocks.push({ 
                          type: 'input_image', 
                          image_url: `data:${block.mimeType};base64,${block.data}`
                      })
                  }
              }
          }

          inputItems.push({ type: 'message', role: 'user', content: blocks })
      }

      // 2. 构建请求体，包含 tools
      const body: Record<string, unknown> = {
          model: this.model,
          input: inputItems,
          stream: true
      }

      // 添加 tools（Responses API FunctionTool 格式）
      if (tools && tools.length > 0) {
          body.tools = tools.map(t => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
              strict: false  // 禁用严格模式以提高兼容性
          }))
      }

      console.debug(`[OpenAI-Responses] Sending to: ${url}`)
      console.debug(`[OpenAI-Responses] Tools count: ${tools?.length || 0}`)
      console.debug(`[OpenAI-Responses] Body: ${JSON.stringify(body, null, 2)}`)  // 临时启用调试
      // console.debug(`[OpenAI-Responses] Body: ${JSON.stringify(body)}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || 120000)

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
          // console.debug(`[OpenAI-Responses] Status: ${response.status}`)

          if (!response.ok) {
              const text = await response.text()
              yield { type: 'error', message: `API Error ${response.status}: ${text}` }
              return
          }

          if (!response.body) return

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let usage: TokenUsage | undefined

          while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                  const trimmed = line.trim()
                  if (!trimmed || !trimmed.startsWith('data: ')) continue
                  
                  const jsonStr = trimmed.slice(6)
                  if (jsonStr === '[DONE]') continue
                  
                  // Debug: Log raw chunk to verify structure
                  // console.debug(`[OpenAI-Responses] Raw Chunk: ${jsonStr.slice(0, 500)}`)

                  try {
                      // Parse event as any to handle various event types dynamically
                      const event = JSON.parse(jsonStr)
                      
                      // Debug: Log event type
                      // console.debug(`[OpenAI-Responses] Event type: ${event.type}`)
                      
                      // Handle text delta
                      if (event.type === 'response.output_text.delta') {
                          if (event.delta) {
                              yield { type: 'text_delta', content: event.delta }
                          }
                      }
                      
                      // Handle function call - when arguments are complete
                      // 事件结构: { type: 'response.function_call_arguments.done', call_id: string, name: string, arguments: string }
                      if (event.type === 'response.function_call_arguments.done') {
                          const callId = event.call_id || event.id || `call_${Date.now()}`
                          const fnName = event.name
                          let fnArgs = {}
                          
                          try {
                              fnArgs = event.arguments ? JSON.parse(event.arguments) : {}
                          } catch {
                              console.debug(`[OpenAI-Responses] Failed to parse function args: ${event.arguments}`)
                          }
                          
                          console.debug(`[OpenAI-Responses] Function call: ${fnName}`)
                          yield { type: 'tool_call', id: callId, name: fnName, args: fnArgs }
                      }
                      
                      // Alternative: Handle function call from output_item.done event
                      // 某些情况下 tool_use 会包装在 output_item 中
                      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
                          const item = event.item
                          const callId = item.call_id || item.id || `call_${Date.now()}`
                          const fnName = item.name
                          let fnArgs = {}
                          
                          try {
                              fnArgs = item.arguments ? JSON.parse(item.arguments) : {}
                          } catch {
                              console.debug(`[OpenAI-Responses] Failed to parse function args from item`)
                          }
                          
                          console.debug(`[OpenAI-Responses] Function call (from item): ${fnName}`)
                          yield { type: 'tool_call', id: callId, name: fnName, args: fnArgs }
                      }
                      
                      // Handle usage from completion event
                      if (event.type === 'response.completed' && event.response?.usage) {
                          usage = {
                              promptTokens: event.response.usage.input_tokens || 0,
                              completionTokens: event.response.usage.output_tokens || 0,
                              totalTokens: (event.response.usage.input_tokens || 0) + (event.response.usage.output_tokens || 0) 
                          }
                      }
                      
                      // Old output structure fallback (just in case)
                      if (event.output) {
                          for (const item of event.output) {
                              if (item.content) {
                                  for (const block of item.content) {
                                      if (block.type === 'output_text') {
                                          yield { type: 'text_delta', content: block.text }
                                      }
                                  }
                              }
                          }
                      }
                  } catch (e) {
                      console.debug('[OpenAI-Responses] Parse error:', e)
                  }
              }
          }
          yield { type: 'done', usage }

      } catch (error: any) {
          clearTimeout(timeoutId)
          yield { type: 'error', message: error.message || String(error) }
      }
  }
}
