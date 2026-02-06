/**
 * OpenAI Format Adapter
 * 
 * 支持两种 API 协议：
 * - Chat Completions API (/v1/chat/completions) - 标准 OpenAI 格式
 * - Responses API (/v1/responses) - 新一代 OpenAI API
 * 
 * 兼容以下模型服务：
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
// Chat Completions API 类型定义
// ============================================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

interface ChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ChatStreamChoice {
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

interface ChatStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: ChatStreamChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ============================================================================
// Responses API 类型定义
// ============================================================================

interface ResponsesContentBlock {
  type: 'input_text' | 'input_image'
  text?: string
  image_url?: string
}

interface ResponsesInputItem {
  type: 'message'
  role: 'user' | 'system' | 'developer'
  content: ResponsesContentBlock[]
}

interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict?: boolean
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
    this.maxContextTokens = this.estimateContextLength(config.model)
  }
  
  /**
   * 根据模型名估算上下文长度
   */
  private estimateContextLength(model: string): number {
    if (model.includes('gpt-4o')) return 128000
    if (model.includes('gpt-4-turbo')) return 128000
    if (model.includes('gpt-4')) return 8192
    if (model.includes('gpt-3.5')) return 16384
    if (model.includes('qwen-max')) return 32000
    if (model.includes('qwen-plus')) return 131072
    if (model.includes('qwen-turbo')) return 131072
    if (model.includes('deepseek')) return 64000
    if (model.includes('moonshot')) return 128000
    return 8192
  }
  
  /**
   * 主入口：根据 baseUrl 判断使用哪种协议
   */
  async *chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const url = this.config.baseUrl.replace(/\/$/, '')
    
    // 根据 URL 后缀判断协议类型
    if (url.endsWith('/responses')) {
      yield* this.chatWithResponses(url, input)
    } else {
      yield* this.chatWithCompletions(url, input)
    }
  }

  // ============================================================================
  // Chat Completions API 实现
  // ============================================================================
  
  /**
   * 使用 Chat Completions API (/v1/chat/completions)
   */
  private async *chatWithCompletions(baseUrl: string, input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // 1. 构建消息列表
    const chatMessages: ChatMessage[] = []
    
    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt })
    }
    
    for (const msg of messages) {
      chatMessages.push(this.convertToChatMessage(msg))
    }
    
    if (toolResults && toolResults.length > 0) {
      for (const result of toolResults) {
        chatMessages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.content
        })
      }
    }
    
    // 2. 构建工具列表
    const chatTools: ChatTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }))
    
    // 3. 构建请求体
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
    const body: Record<string, unknown> = {
      model: this.model,
      messages: chatMessages,
      stream: true,
      stream_options: { include_usage: true }
    }
    
    if (chatTools && chatTools.length > 0) {
      body.tools = chatTools
    }
    if (this.config.maxTokens) {
      body.max_tokens = this.config.maxTokens
    }
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature
    }
    
    // 4. 发起请求并处理 SSE 流
    yield* this.streamRequest(url, body, this.parseChatCompletionsEvent.bind(this))
  }
  
  /**
   * 转换内部消息格式到 Chat Completions 格式
   */
  private convertToChatMessage(msg: Message): ChatMessage {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }
    }
    
    const content = msg.content.map(block => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text }
      } else {
        return {
          type: 'image_url' as const,
          image_url: { url: `data:${block.mimeType};base64,${block.data}` }
        }
      }
    })
    
    return {
      role: msg.role as 'user' | 'assistant',
      content
    }
  }
  
  /**
   * 解析 Chat Completions SSE 事件
   */
  private *parseChatCompletionsEvent(
    jsonStr: string,
    state: StreamParserState
  ): Generator<LLMEvent> {
    const chunk: ChatStreamChunk = JSON.parse(jsonStr)
    
    // 提取 usage
    if (chunk.usage) {
      state.usage = {
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
      
      // Tool calls 增量
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          
          if (!state.pendingToolCalls.has(idx)) {
            state.pendingToolCalls.set(idx, { id: '', name: '', args: '' })
          }
          
          const pending = state.pendingToolCalls.get(idx)!
          
          if (tc.id) pending.id = tc.id
          if (tc.function?.name) pending.name = tc.function.name
          if (tc.function?.arguments) {
            pending.args += tc.function.arguments
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
        for (const [, tc] of state.pendingToolCalls) {
          if (tc.id && tc.name) {
            try {
              const args = tc.args ? JSON.parse(tc.args) : {}
              yield { type: 'tool_call', id: tc.id, name: tc.name, args }
            } catch {
              yield { type: 'error', message: `Failed to parse tool args: ${tc.args}` }
            }
          }
        }
        state.pendingToolCalls.clear()
      }
    }
  }

  // ============================================================================
  // Responses API 实现
  // ============================================================================
  
  /**
   * 使用 Responses API (/v1/responses)
   * 
   * 注意：Responses API 的消息格式与 Chat Completions 不同
   * - 需要 type: 'message' 字段
   * - role 使用 developer/system/user
   * - 不直接支持 assistant 历史消息
   */
  private async *chatWithResponses(url: string, input: {
    messages: Message[]
    tools?: ToolSchema[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, systemPrompt } = input
    
    // 1. 构建输入消息
    const inputItems: ResponsesInputItem[] = []
    
    // System prompt 使用 developer role
    if (systemPrompt) {
      inputItems.push({
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: systemPrompt }]
      })
    }
    
    // 仅处理 user 消息（Responses API 不直接支持 assistant 历史）
    for (const msg of messages) {
      if (msg.role !== 'user') continue
      inputItems.push(this.convertToResponsesMessage(msg))
    }
    
    // 2. 构建工具列表
    const responsesTools: ResponsesTool[] | undefined = tools?.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      strict: false
    }))
    
    // 3. 构建请求体
    const body: Record<string, unknown> = {
      model: this.model,
      input: inputItems,
      stream: true
    }
    
    if (responsesTools && responsesTools.length > 0) {
      body.tools = responsesTools
    }
    
    // 4. 发起请求并处理 SSE 流
    yield* this.streamRequest(url, body, this.parseResponsesEvent.bind(this))
  }
  
  /**
   * 转换内部消息格式到 Responses API 格式
   */
  private convertToResponsesMessage(msg: Message): ResponsesInputItem {
    const blocks: ResponsesContentBlock[] = []
    
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
    
    return { type: 'message', role: 'user', content: blocks }
  }
  
  /**
   * 解析 Responses API SSE 事件
   */
  private *parseResponsesEvent(
    jsonStr: string,
    state: StreamParserState
  ): Generator<LLMEvent> {
    const event = JSON.parse(jsonStr)
    
    // 文本增量
    if (event.type === 'response.output_text.delta' && event.delta) {
      yield { type: 'text_delta', content: event.delta }
    }
    
    // 函数调用完成（方式1：直接事件）
    if (event.type === 'response.function_call_arguments.done') {
      yield* this.emitFunctionCall(event.call_id || event.id, event.name, event.arguments)
    }
    
    // 函数调用完成（方式2：通过 output_item）
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const item = event.item
      yield* this.emitFunctionCall(item.call_id || item.id, item.name, item.arguments)
    }
    
    // 响应完成，提取 usage
    if (event.type === 'response.completed' && event.response?.usage) {
      const u = event.response.usage
      state.usage = {
        promptTokens: u.input_tokens || 0,
        completionTokens: u.output_tokens || 0,
        totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0)
      }
    }
  }
  
  /**
   * 发送函数调用事件
   */
  private *emitFunctionCall(callId: string | undefined, name: string, argsStr: string): Generator<LLMEvent> {
    const id = callId || `call_${Date.now()}`
    let args = {}
    
    try {
      args = argsStr ? JSON.parse(argsStr) : {}
    } catch {
      // 忽略解析错误
    }
    
    yield { type: 'tool_call', id, name, args }
  }

  // ============================================================================
  // 公共 SSE 流处理
  // ============================================================================
  
  /**
   * 通用的 SSE 流请求处理
   */
  private async *streamRequest(
    url: string,
    body: Record<string, unknown>,
    parseEvent: (jsonStr: string, state: StreamParserState) => Generator<LLMEvent>
  ): AsyncGenerator<LLMEvent> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout || 120000
    )
    
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
      const state: StreamParserState = {
        pendingToolCalls: new Map(),
        usage: undefined
      }
      
      yield* this.parseSSEStream(response.body, parseEvent, state)
      yield { type: 'done', usage: state.usage }
      
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
   * 解析 SSE 流
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    parseEvent: (jsonStr: string, state: StreamParserState) => Generator<LLMEvent>,
    state: StreamParserState
  ): AsyncGenerator<LLMEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    
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
        if (jsonStr === '[DONE]') continue
        
        try {
          yield* parseEvent(jsonStr, state)
        } catch {
          // 忽略解析错误，继续处理
        }
      }
    }
  }
}

// ============================================================================
// 辅助类型
// ============================================================================

interface StreamParserState {
  pendingToolCalls: Map<number, { id: string; name: string; args: string }>
  usage: TokenUsage | undefined
}
