/**
 * Gemini Format Adapter
 *
 * Compatible with Google Gemini API.
 * - Gemini 2.0 Flash
 * - Gemini 1.5 Pro
 * - Gemini 1.5 Flash
 * - Other Gemini models
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

const logger = new Logger('GeminiAdapter')

// ============================================================================
// NOTE: documentation updated to English.
// ============================================================================

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

type GeminiPart = 
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
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
// NOTE: documentation updated to English.
// ============================================================================

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function sanitizeParts(parts: GeminiPart[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if ('text' in part) {
      return { text: truncate(part.text, 300) }
    }
    if ('inlineData' in part) {
      return { inlineData: { mimeType: part.inlineData.mimeType, data: '[base64]' } }
    }
    if ('functionCall' in part) {
      return { functionCall: { name: part.functionCall.name, args: part.functionCall.args } }
    }
    if ('functionResponse' in part) {
      return {
        functionResponse: {
          name: part.functionResponse.name,
          response: { content: truncate(part.functionResponse.response.content, 500) }
        }
      }
    }
    return { unknownPart: true }
  })
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      return { _raw: args }
    }
  }
  if (typeof args === 'object') return args as Record<string, unknown>
  return { _raw: args }
}

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

    logger.debug(
      `[gemini] request start messages=${messages.length}, tools=${tools?.length || 0}, toolResults=${toolResults?.length || 0}, systemPrompt=${systemPrompt ? 'yes' : 'no'}`
    )
    
    // NOTE: documentation updated to English.
    const geminiContents: GeminiContent[] = []
    
    // NOTE: documentation updated to English.
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        geminiContents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })
      } else {
        // Structured content (ContentBlock[])
        const parts: GeminiPart[] = msg.content.map(block => {
          if (block.type === 'text') {
            return { text: block.text }
          } else {
            // Image block
            return {
              inlineData: {
                mimeType: block.mimeType,
                data: block.data
              }
            }
          }
        })
        
        geminiContents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts
        })
      }
    }
    
    // NOTE: documentation updated to English.
    if (toolResults && toolResults.length > 0) {
      for (const r of toolResults) {
        if (!r.toolName) {
          logger.error(
            `[gemini] toolResult missing toolName (toolCallId=${r.toolCallId}, isError=${r.isError ? 'yes' : 'no'})`
          )
          yield { type: 'error', message: 'Gemini tool result missing toolName for functionResponse.' }
          return
        }
      }

      logger.debug(
        `[gemini] toolResults summary: ${toolResults
          .map(r => `${r.toolName}:${r.toolCallId}:${(r.content || '').length}`)
          .join(', ')}`
      )

      const toolCallParts: GeminiPart[] = toolResults.map(r => ({
        functionCall: {
          name: r.toolName!,
          args: normalizeArgs(r.toolArgs)
        }
      }))

      const parts: GeminiPart[] = toolResults.map(r => ({
        functionResponse: {
          name: r.toolName!,
          response: { content: r.content }
        }
      }))

      // Gemini expects the corresponding functionCall to appear in the model role
      // before the functionResponse is provided by the user.
      geminiContents.push({
        role: 'model',
        parts: toolCallParts
      })
      
      geminiContents.push({
        role: 'user',
        parts
      })
    }
    
    // NOTE: documentation updated to English.
    const functionDeclarations: GeminiFunctionDeclaration[] | undefined = tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema
    }))
    
    // NOTE: documentation updated to English.
    // NOTE: documentation updated to English.
    const baseUrl = this.config.baseUrl.replace(/\/$/, '')
    const url = `${baseUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`
    const safeUrl = url.replace(/key=[^&]+/i, 'key=***')
    
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
      logger.debug(
        `[gemini] POST ${safeUrl} (model=${this.model}, contents=${geminiContents.length}, tools=${functionDeclarations?.length || 0})`
      )
      const sanitizedBody: Record<string, unknown> = {
        contents: geminiContents.map((c) => ({
          role: c.role,
          parts: sanitizeParts(c.parts)
        })),
        generationConfig: body.generationConfig,
        systemInstruction: systemPrompt ? { parts: [{ text: truncate(systemPrompt, 500) }] } : undefined,
        tools: functionDeclarations && functionDeclarations.length > 0
          ? [{ functionDeclarations: functionDeclarations.map(fd => ({
            name: fd.name,
            description: fd.description,
            parameters: fd.parameters
          })) }]
          : undefined
      }
      const bodyPreview = JSON.stringify(sanitizedBody).slice(0, 2000)
      logger.debug(`[gemini] request body (sanitized, truncated): ${bodyPreview}`)
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
        logger.error(
          `[gemini] API error status=${response.status} body=${errorText.slice(0, 800)}`
        )
        yield { type: 'error', message: `API error ${response.status}: ${errorText}` }
        return
      }
      
      if (!response.body) {
        logger.error('[gemini] No response body')
        yield { type: 'error', message: 'No response body' }
        return
      }
      
      // NOTE: documentation updated to English.
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
            
            // NOTE: documentation updated to English.
            if (chunk.usageMetadata) {
              usage = {
                promptTokens: chunk.usageMetadata.promptTokenCount,
                completionTokens: chunk.usageMetadata.candidatesTokenCount,
                totalTokens: chunk.usageMetadata.totalTokenCount
              }
            }
            
            // NOTE: documentation updated to English.
            if (chunk.candidates) {
              for (const candidate of chunk.candidates) {
                for (const part of candidate.content.parts) {
                  if ('text' in part) {
                    yield { type: 'text_delta', content: part.text }
                  }
                  if ('functionCall' in part) {
                    // NOTE: documentation updated to English.
                    // NOTE: documentation updated to English.
                    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
                    yield {
                      type: 'tool_call',
                      id: callId,
                      name: part.functionCall.name,
                      args: part.functionCall.args
                    }
                  }
                }
              }
            }
          } catch (e) {
            logger.debug('[Gemini] Failed to parse chunk:', jsonStr, e)
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



