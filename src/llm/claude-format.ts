/**
 * Claude Format Adapter
 * 
 * 兼容 Anthropic Claude API
 * - Claude 3.5 Sonnet
 * - Claude 3 Opus
 * - Claude 3 Haiku
 * - 其他 Claude 模型
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
// Claude API 类型定义
// ============================================================================

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

type ClaudeContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface ClaudeTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface ClaudeStreamEvent {
  type: string
  index?: number
  message?: {
    id: string
    type: string
    role: string
    content: ClaudeContentBlock[]
    model: string
    stop_reason: string | null
    usage: { input_tokens: number; output_tokens: number }
  }
  content_block?: ClaudeContentBlock
  delta?: {
    type: string
    text?: string
    partial_json?: string
  }
  usage?: { input_tokens: number; output_tokens: number }
}

// ============================================================================
// Claude Format Adapter 实现
// ============================================================================

export class ClaudeFormatAdapter implements LLMAdapter {
  readonly name = 'claude-format'
  readonly model: string
  readonly maxContextTokens: number
  
  private config: LLMConfig
  
  constructor(config: LLMConfig) {
    this.config = config
    this.model = config.model
    this.maxContextTokens = this.estimateContextLength(config.model)
  }
  
  private estimateContextLength(model: string): number {
    if (model.includes('claude-3') || model.includes('claude-sonnet-4')) return 200000
    if (model.includes('claude-2')) return 100000
    return 100000
  }
  
  async *chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // 构建 Claude 格式的消息
    const claudeMessages: ClaudeMessage[] = []
    
    // 转换消息历史
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        claudeMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      } else {
        // Structured content (ContentBlock[])
        const content: ClaudeContentBlock[] = msg.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text }
          } else {
            // Image block
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: block.mimeType,
                data: block.data
              }
            }
          }
        })
        
        claudeMessages.push({
          role: msg.role as 'user' | 'assistant',
          content
        })
      }
    }
    
    // 添加 tool results（如果有）- Claude 需要将 tool_result 作为 user 消息
    if (toolResults && toolResults.length > 0) {
      const toolResultBlocks: ClaudeContentBlock[] = toolResults.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.toolCallId,
        content: r.content,
        is_error: r.isError
      }))
      
      claudeMessages.push({
        role: 'user',
        content: toolResultBlocks
      })
    }
    
    // 构建 tools
    const claudeTools: ClaudeTool[] | undefined = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }))
    
    // 发起请求
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/messages`
    
    const body: Record<string, unknown> = {
      model: this.model,
      messages: claudeMessages,
      max_tokens: this.config.maxTokens || 4096,
      stream: true
    }
    
    if (systemPrompt) {
      body.system = systemPrompt
    }
    
    if (claudeTools && claudeTools.length > 0) {
      body.tools = claudeTools
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
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const errorText = await response.text()
        let cleanMessage = errorText
        
        // 如果是 HTML 错误（通常是 502/504 网关错误），只返回状态码简述
        if (errorText.trim().startsWith('<') || errorText.includes('<!DOCTYPE html>')) {
           cleanMessage = `Gateway Error (${response.statusText || 'Unknown'})`
        } else {
           // 尝试解析 JSON 错误信息
           try {
             const errorJson = JSON.parse(errorText)
             cleanMessage = errorJson.error?.message || errorJson.message || errorText
           } catch {
             // 非 JSON 文本，截断过长的内容
             if (cleanMessage.length > 200) {
               cleanMessage = cleanMessage.slice(0, 200) + '...'
             }
           }
        }
        
        yield { type: 'error', message: `API error ${response.status}: ${cleanMessage}` }
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
      
      // 用于累积 tool_use
      let currentToolUse: { id: string; name: string; inputJson: string } | null = null
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
          try {
            const event: ClaudeStreamEvent = JSON.parse(jsonStr)
            
            switch (event.type) {
              case 'message_start':
                if (event.message?.usage) {
                  usage = {
                    promptTokens: event.message.usage.input_tokens,
                    completionTokens: event.message.usage.output_tokens,
                    totalTokens: event.message.usage.input_tokens + event.message.usage.output_tokens
                  }
                }
                break
                
              case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                  currentToolUse = {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    inputJson: ''
                  }
                }
                break
                
              case 'content_block_delta':
                if (event.delta?.type === 'text_delta' && event.delta.text) {
                  yield { type: 'text_delta', content: event.delta.text }
                }
                if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                  if (currentToolUse) {
                    currentToolUse.inputJson += event.delta.partial_json
                    yield {
                      type: 'tool_call_delta',
                      id: currentToolUse.id,
                      name: currentToolUse.name,
                      argsFragment: event.delta.partial_json
                    }
                  }
                }
                break
                
              case 'content_block_stop':
                if (currentToolUse) {
                  try {
                    const args = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {}
                    yield {
                      type: 'tool_call',
                      id: currentToolUse.id,
                      name: currentToolUse.name,
                      args
                    }
                  } catch {
                    yield { type: 'error', message: `Failed to parse tool args: ${currentToolUse.inputJson}` }
                  }
                  currentToolUse = null
                }
                break
                
              case 'message_delta':
                if (event.usage) {
                  usage = {
                    promptTokens: usage?.promptTokens || 0,
                    completionTokens: event.usage.output_tokens,
                    totalTokens: (usage?.promptTokens || 0) + event.usage.output_tokens
                  }
                }
                break
            }
          } catch (e) {
            console.debug('[Claude] Failed to parse event:', jsonStr, e)
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
