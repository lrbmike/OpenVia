/**
 * Policy Engine - 策略引擎
 * 
 * 负责：
 * - 决定某个 Tool Call 是否允许执行
 * - 做参数校验
 * - 做用户 / session 权限判断
 * - 记录审计日志
 */

import type { ToolDefinition } from './registry'

// ============================================================================
// 类型定义
// ============================================================================

/** 策略决策 */
export type PolicyDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'require_approval'; prompt: string }

/** Session 上下文 */
export interface SessionContext {
  userId: string
  chatId: string
  allowedTools?: string[]  // 如果指定，只允许这些工具
  deniedTools?: string[]   // 如果指定，禁用这些工具
}

/** 策略规则 */
export interface PolicyRule {
  /** 规则名称 */
  name: string
  /** 匹配工具名称（支持通配符 *） */
  toolPattern: string
  /** 决策类型 */
  decision: 'allow' | 'deny' | 'require_approval'
  /** 原因/提示 */
  reason?: string
}

/** 审计日志条目 */
export interface AuditEntry {
  timestamp: number
  userId: string
  chatId: string
  tool: string
  args: unknown
  decision: PolicyDecision
}

// ============================================================================
// Policy Engine 实现
// ============================================================================

export class PolicyEngine {
  private rules: PolicyRule[] = []
  private auditLog: AuditEntry[] = []
  private maxAuditEntries = 1000
  
  // 需要确认的 Shell 命令列表
  private shellConfirmList: string[] = [
    'rm', 'mv', 'sudo', 'su', 'dd', 'reboot', 'shutdown', 
    'mkfs', 'chmod', 'chown', '>', '>>', '|'
  ]
  
  constructor(options?: { shellConfirmList?: string[] }) {
    if (options?.shellConfirmList) {
      this.shellConfirmList = options.shellConfirmList
    }
  }
  
  /**
   * 添加策略规则
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule)
  }
  
  /**
   * 设置 Shell 确认列表
   */
  setShellConfirmList(list: string[]): void {
    this.shellConfirmList = list
  }
  
  /**
   * 评估工具调用
   */
  async evaluate(input: {
    tool: ToolDefinition
    args: unknown
    session: SessionContext
  }): Promise<PolicyDecision> {
    const { tool, args, session } = input
    
    // 1. 检查用户级工具白名单/黑名单
    if (session.deniedTools?.includes(tool.name)) {
      return { type: 'deny', reason: `Tool "${tool.name}" is denied for this user` }
    }
    
    if (session.allowedTools && !session.allowedTools.includes(tool.name)) {
      return { type: 'deny', reason: `Tool "${tool.name}" is not in allowed list` }
    }
    
    // 2. 检查自定义规则
    for (const rule of this.rules) {
      if (this.matchPattern(tool.name, rule.toolPattern)) {
        if (rule.decision === 'allow') {
          return { type: 'allow' }
        } else if (rule.decision === 'deny') {
          return { type: 'deny', reason: rule.reason || 'Denied by policy rule' }
        } else {
          return { type: 'require_approval', prompt: rule.reason || `Approve ${tool.name}?` }
        }
      }
    }
    
    // 3. 内置规则：只读工具自动允许
    const readOnlyTools = ['read', 'read_file', 'list', 'ls', 'search', 'grep', 'glob', 'view']
    if (readOnlyTools.some(t => tool.name.toLowerCase().includes(t))) {
      return { type: 'allow' }
    }
    
    // 4. 内置规则：Bash 命令检查
    if (tool.name.toLowerCase() === 'bash' || tool.name.toLowerCase() === 'shell') {
      const command = (args as { command?: string })?.command || ''
      const requiresConfirmation = this.shellConfirmList.some(item => command.includes(item))
      
      if (requiresConfirmation) {
        return {
          type: 'require_approval',
          prompt: `⚠️ *Permission Request*\n\nTool: \`${tool.name}\`\nCommand: \`${command}\``
        }
      }
      return { type: 'allow' }
    }
    
    // 5. 写入类操作需要确认
    const writeTools = ['write', 'edit', 'delete', 'remove', 'create']
    if (writeTools.some(t => tool.name.toLowerCase().includes(t))) {
      const filePath = (args as { path?: string; file?: string })?.path || 
                       (args as { path?: string; file?: string })?.file || 
                       'unknown'
      return {
        type: 'require_approval',
        prompt: `⚠️ *Permission Request*\n\nTool: \`${tool.name}\`\nFile: \`${filePath}\``
      }
    }
    
    // 6. 默认：需要确认
    return {
      type: 'require_approval',
      prompt: `⚠️ *Permission Request*\n\nTool: \`${tool.name}\`\nArgs: \`${JSON.stringify(args).slice(0, 100)}...\``
    }
  }
  
  /**
   * 记录审计日志
   */
  logAudit(entry: Omit<AuditEntry, 'timestamp'>): void {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: Date.now()
    }
    
    this.auditLog.push(fullEntry)
    
    // 截断
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditEntries)
    }
    
    // 控制台输出
    const status = entry.decision.type === 'allow' ? '✓' : 
                   entry.decision.type === 'deny' ? '✗' : '?'
    console.log(`[Audit] ${status} User:${entry.userId} Tool:${entry.tool}`)
  }
  
  /**
   * 获取审计日志
   */
  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(-limit)
  }
  
  /**
   * 匹配工具名称模式
   */
  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1))
    }
    return name === pattern
  }
}

// 单例
let policyInstance: PolicyEngine | null = null

export function getPolicyEngine(): PolicyEngine {
  if (!policyInstance) {
    policyInstance = new PolicyEngine()
  }
  return policyInstance
}
