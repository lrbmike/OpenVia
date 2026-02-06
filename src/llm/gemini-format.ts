/**
 * Gemini Format Adapter
 * 
 * 兼容 Google Gemini API
 * - Gemini 2.0 Flash
 * - Gemini 1.5 Pro
 * - Gemini 1.5 Flash
 * - 其他 Gemini 模型
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
// Gemini API 类型定义
// ============================================================================

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

type GeminiPart = 
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: string } } }

interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content: {
      parts: GeminiPart[]
      role: string
    }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

// ============================================================================
// Gemini Format Adapter 实现
// ============================================================================

export class GeminiFormatAdapter implements LLMAdapter {
  readonly name = 'gemini-format'
  readonly model: string
  readonly maxContextTokens: number
  
  private config: LLMConfig
  
  constructor(config: LLMConfig) {
    this.config = config
    this.model = config.model
    this.maxContextTokens = this.estimateContextLength(config.model)
  }
  
  private estimateContextLength(model: string): number {
    if (model.includes('gemini-2')) return 1000000
    if (model.includes('gemini-1.5-pro')) return 2000000
    if (model.includes('gemini-1.5-flash')) return 1000000
    if (model.includes('gemini-1.0')) return 32000
    return 32000
  }
  
  async *chat(input: {
    messages: Message[]
    tools?: ToolSchema[]
    toolResults?: ToolResult[]
    systemPrompt?: string
  }): AsyncGenerator<LLMEvent> {
    const { messages, tools, toolResults, systemPrompt } = input
    
    // 构建 Gemini 格式的消息
    const geminiContents: GeminiContent[] = []
    
    // 转换消息历史
    for (const msg of messages) {
      geminiContents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })
    }
    
    // 添加 tool results（如果有）
    if (toolResults && toolResults.length > 0) {
      const parts: GeminiPart[] = toolResults.map(r => ({
        functionResponse: {
          name: r.toolCallId, // Gemini 用 name 而不是 id
          response: { content: r.content }
        }
      }))
      
      geminiContents.push({
        role: 'user',
        parts
      })
    }
    
    // 构建 tools
    const functionDeclarations: GeminiFunctionDeclaration[] | undefined = tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema
    }))
    
    // 发起请求
    // Gemini API URL 格式: /v1beta/models/{model}:streamGenerateContent
    const baseUrl = this.config.baseUrl.replace(/\/$/, '')
    const url = `${baseUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`
    
    const body: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 8192
      }
    }
    
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] }
    }
    
    if (functionDeclarations && functionDeclarations.length > 0) {
      body.tools = [{ functionDeclarations }]
    }
    
    if (this.config.temperature !== undefined) {
      (body.generationConfig as Record<string, unknown>).temperature = this.config.temperature
    }
    
    const controller = new AbortController()
    const timeout = this.config.timeout || 120000
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
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
            const chunk: GeminiStreamChunk = JSON.parse(jsonStr)
            
            // 提取 usage
            if (chunk.usageMetadata) {
              usage = {
                promptTokens: chunk.usageMetadata.promptTokenCount,
                completionTokens: chunk.usageMetadata.candidatesTokenCount,
                totalTokens: chunk.usageMetadata.totalTokenCount
              }
            }
            
            // 处理 candidates
            if (chunk.candidates) {
              for (const candidate of chunk.candidates) {
                for (const part of candidate.content.parts) {
                  if ('text' in part) {
                    yield { type: 'text_delta', content: part.text }
                  }
                  if ('functionCall' in part) {
                    yield {
                      type: 'tool_call',
                      id: part.functionCall.name, // Gemini 没有单独的 id，用 name
                      name: part.functionCall.name,
                      args: part.functionCall.args
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.debug('[Gemini] Failed to parse chunk:', jsonStr, e)
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
