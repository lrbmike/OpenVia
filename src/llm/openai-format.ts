/**
 * OpenAI Format Adapter
 *
 * Supports:
 * - Chat Completions API (/v1/chat/completions)
 * - Responses API (/v1/responses)
 *
 * Compatible with OpenAI-style providers (OpenAI, Qwen, DeepSeek, Moonshot, Ollama, etc.).
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
import { Logger } from '../utils/logger'

const logger = new Logger('OpenAIAdapter')

// ============================================================================
// NOTE: documentation updated to English.
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
// NOTE: documentation updated to English.
// ============================================================================

interface ResponsesInputTextBlock {
  type: 'input_text'
  text: string
}

interface ResponsesInputImageBlock {
  type: 'input_image'
  image_url: string
}

interface ResponsesOutputTextBlock {
  type: 'output_text'
  text: string
}

interface ResponsesRefusalBlock {
  type: 'refusal'
  refusal: string
}

type ResponsesContentBlock =
  | ResponsesInputTextBlock
  | ResponsesInputImageBlock
  | ResponsesOutputTextBlock
  | ResponsesRefusalBlock

interface ResponsesInputItem {
  type: 'message'
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: ResponsesContentBlock[]
}

interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output'
  call_id: string
  output: string
}

interface ResponsesFunctionCallItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type ResponsesInput = ResponsesInputItem | ResponsesFunctionCallItem | ResponsesFunctionCallOutputItem

interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict?: boolean
}

// ============================================================================
// NOTE: documentation updated to English.
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
   * NOTE: documentation updated to English.
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
   * NOTE: documentation updated to English.
   */
  async *chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const url = this.config.baseUrl.replace(/\/$/, '')
    const useResponses = url.endsWith('/responses')
    logger.debug(`Dispatching request via ${useResponses ? 'responses' : 'chat.completions'} (baseUrl=${url})`)
    
    // NOTE: documentation updated to English.
    if (useResponses) {
      yield* this.chatWithResponses(url, input)
    } else {
      yield* this.chatWithCompletions(url, input)
    }
  }

  // ============================================================================
  // NOTE: documentation updated to English.
  // ============================================================================
  
  /**
   * NOTE: documentation updated to English.
   */
  private async *chatWithCompletions(baseUrl: string, input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // NOTE: documentation updated to English.
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
    
    // NOTE: documentation updated to English.
    const chatTools: ChatTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }))
    
    // NOTE: documentation updated to English.
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
    logger.debug(`[chat.completions] messages=${chatMessages.length}, tools=${chatTools?.length || 0}, toolResults=${toolResults?.length || 0}`)
    
    // NOTE: documentation updated to English.
    yield* this.streamRequest(url, body, this.parseChatCompletionsEvent.bind(this))
  }
  
  /**
   * NOTE: documentation updated to English.
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
   * NOTE: documentation updated to English.
   */
  private *parseChatCompletionsEvent(
    jsonStr: string,
    state: StreamParserState
  ): Generator<LLMEvent> {
    const chunk: ChatStreamChunk = JSON.parse(jsonStr)
    
    // NOTE: documentation updated to English.
    if (chunk.usage) {
      state.usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens
      }
    }
    
    for (const choice of chunk.choices) {
      const delta = choice.delta
      
      // NOTE: documentation updated to English.
      if (delta.content) {
        yield { type: 'text_delta', content: delta.content }
      }
      
      // NOTE: documentation updated to English.
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
      
      // NOTE: documentation updated to English.
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
  // NOTE: documentation updated to English.
  // ============================================================================
  
  /**
   * NOTE: documentation updated to English.
   * 
   * NOTE: documentation updated to English.
   * NOTE: documentation updated to English.
   * NOTE: documentation updated to English.
   * NOTE: documentation updated to English.
   */
  private async *chatWithResponses(url: string, input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // NOTE: documentation updated to English.
    const inputItems: ResponsesInput[] = []
    
    // NOTE: documentation updated to English.
    if (systemPrompt) {
      inputItems.push({
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: systemPrompt }]
      })
    }
    // Convert history messages
    let userMessageCount = 0
    let assistantMessageCount = 0
    for (const msg of messages) {
      if (msg.role === 'system') continue
      if (msg.role === 'assistant') assistantMessageCount += 1
      else userMessageCount += 1
      inputItems.push(this.convertToResponsesMessage(msg))
    }
    // Append tool call results for Responses API
    if (toolResults && toolResults.length > 0) {
      for (const result of toolResults) {
        if (!result.toolCallId) continue
        const args =
          typeof result.toolArgs === 'string'
            ? result.toolArgs
            : JSON.stringify(result.toolArgs ?? {})
        const name = result.toolName || 'unknown_tool'
        inputItems.push({
          type: 'function_call',
          call_id: result.toolCallId,
          name,
          arguments: args
        })
        inputItems.push({
          type: 'function_call_output',
          call_id: result.toolCallId,
          output: result.content
        })
      }
    }
    
    // NOTE: documentation updated to English.
    const responsesTools: ResponsesTool[] | undefined = tools?.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      strict: false
    }))
    
    // NOTE: documentation updated to English.
    const body: Record<string, unknown> = {
      model: this.model,
      input: inputItems,
      stream: true
    }
    
    if (responsesTools && responsesTools.length > 0) {
      body.tools = responsesTools
    }
    if (this.config.maxTokens) {
      body.max_output_tokens = this.config.maxTokens
    }
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature
    }
    logger.debug(
      `[responses] inputItems=${inputItems.length}, userMessages=${userMessageCount}, assistantMessages=${assistantMessageCount}, tools=${responsesTools?.length || 0}, toolResults=${toolResults?.length || 0}`
    )

    
    // NOTE: documentation updated to English.
    yield* this.streamRequest(url, body, this.parseResponsesEvent.bind(this))
  }
  
  /**
   * NOTE: documentation updated to English.
   */
  private convertToResponsesMessage(msg: Message): ResponsesInputItem {
    const role = msg.role === 'assistant' ? 'assistant' : 'user'

    if (role === 'assistant') {
      const blocks: ResponsesContentBlock[] = []

      if (typeof msg.content === 'string') {
        blocks.push({ type: 'output_text', text: msg.content })
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            blocks.push({ type: 'output_text', text: block.text })
          }
        }
      }

      if (blocks.length === 0) {
        blocks.push({ type: 'output_text', text: '' })
      }

      return { type: 'message', role, content: blocks }
    }

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

    return { type: 'message', role, content: blocks }
  }
  
  /**
   * NOTE: documentation updated to English.
   */
  private *parseResponsesEvent(
    jsonStr: string,
    state: StreamParserState
  ): Generator<LLMEvent> {
    const event = JSON.parse(jsonStr)
    
    // NOTE: documentation updated to English.
    if (event.type === 'response.output_text.delta' && event.delta) {
      yield { type: 'text_delta', content: event.delta }
    }
    
    // NOTE: documentation updated to English.
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const item = event.item
      const callId = item.call_id
      const itemId = item.id
      if (itemId && callId && item.name) {
        state.responsesItems.set(itemId, { callId, name: item.name })
      }
    }
    
    // NOTE: documentation updated to English.
    if (event.type === 'response.function_call_arguments.done') {
      const itemId = event.item_id
      const cached = state.responsesItems.get(itemId) // Map item_id to cached call metadata.
      
      const id = cached?.callId || event.call_id || event.id || `call_${Date.now()}`
      const name = cached?.name || event.name || ''
      
      if (!state.emittedCallIds.has(id)) {
        state.emittedCallIds.add(id)
        yield* this.emitFunctionCall(id, name, event.arguments)
      }
    }
    
    // NOTE: documentation updated to English.
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const item = event.item
      const itemId = item.id
      const cached = state.responsesItems.get(itemId)
      
      const id = item.call_id || cached?.callId || item.id || `call_${Date.now()}`
      const name = item.name || cached?.name || ''
      
      if (!state.emittedCallIds.has(id)) {
        state.emittedCallIds.add(id)
        yield* this.emitFunctionCall(id, name, item.arguments)
      }
    }
    
    // NOTE: documentation updated to English.
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
   * NOTE: documentation updated to English.
   */
  private *emitFunctionCall(callId: string | undefined, name: string, argsStr: string): Generator<LLMEvent> {
    const id = callId || `call_${Date.now()}`
    let args = {}
    
    try {
      args = argsStr ? JSON.parse(argsStr) : {}
    } catch {
      // NOTE: documentation updated to English.
    }
    
    if (name) {
      yield { type: 'tool_call', id, name, args }
    } else {
      yield { type: 'error', message: `Function call missing name (id: ${id})` }
    }
  }

  // ============================================================================
  // NOTE: documentation updated to English.
  // ============================================================================
  
  /**
   * NOTE: documentation updated to English.
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
      logger.debug(`POST ${url} (${this.summarizeRequestBody(body)})`)
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
        logger.error(
          `OpenAI API request failed: status=${response.status}, url=${url}, ${this.summarizeRequestBody(body)}, error=${this.truncate(errorText)}`
        )
        yield { type: 'error', message: `API error ${response.status}: ${errorText}` }
        return
      }
      
      if (!response.body) {
        yield { type: 'error', message: 'No response body' }
        return
      }
      
      // NOTE: documentation updated to English.
      const state: StreamParserState = {
        pendingToolCalls: new Map(),
        responsesItems: new Map(),
        emittedCallIds: new Set(),
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
   * NOTE: documentation updated to English.
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
        } catch (e) {
          logger.debug(`Failed to parse SSE event: ${this.truncate(jsonStr, 300)}`, e)
          // NOTE: documentation updated to English.
        }
      }
    }
  }

  private summarizeRequestBody(body: Record<string, unknown>): string {
    const model = typeof body.model === 'string' ? body.model : 'unknown'
    const toolsCount = Array.isArray(body.tools) ? body.tools.length : 0
    const messagesCount = Array.isArray(body.messages) ? body.messages.length : 0
    const inputItemsCount = Array.isArray(body.input) ? body.input.length : 0
    const stream = body.stream === true
    return `model=${model}, stream=${stream}, messages=${messagesCount}, inputItems=${inputItemsCount}, tools=${toolsCount}`
  }

  private truncate(text: string, maxLength = 800): string {
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}...`
  }
}

// ============================================================================
// NOTE: documentation updated to English.
// ============================================================================

interface StreamParserState {
  pendingToolCalls: Map<number, { id: string; name: string; args: string }>
  // Map item_id to { call_id, name }
  responsesItems: Map<string, { callId: string; name: string }>
  // Track emitted call IDs to prevent duplicates
  emittedCallIds: Set<string>
  usage: TokenUsage | undefined
}


