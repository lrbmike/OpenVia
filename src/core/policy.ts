/**
 * Policy Engine - 绛栫暐寮曟搸
 * 
 * 璐熻矗锛?
 * - 鍐冲畾鏌愪釜 Tool Call 鏄惁鍏佽鎵ц
 * - 鍋氬弬鏁版牎楠?
 * - 鍋氱敤鎴?/ session 鏉冮檺鍒ゆ柇
 * - 璁板綍瀹¤鏃ュ織
 */

import type { ToolDefinition } from './registry'
import { Logger } from '../utils/logger'

const logger = new Logger('PolicyEngine')

// ============================================================================
// 绫诲瀷瀹氫箟
// ============================================================================

/** 绛栫暐鍐崇瓥 */
export type PolicyDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'require_approval'; prompt: string }

/** Session 涓婁笅鏂?*/
export interface SessionContext {
  userId: string
  chatId: string
  allowedTools?: string[]  // 濡傛灉鎸囧畾锛屽彧鍏佽杩欎簺宸ュ叿
  deniedTools?: string[]   // 濡傛灉鎸囧畾锛岀鐢ㄨ繖浜涘伐鍏?
}

/** 绛栫暐瑙勫垯 */
export interface PolicyRule {
  /** 瑙勫垯鍚嶇О */
  name: string
  /** 鍖归厤宸ュ叿鍚嶇О锛堟敮鎸侀€氶厤绗?*锛?*/
  toolPattern: string
  /** 鍐崇瓥绫诲瀷 */
  decision: 'allow' | 'deny' | 'require_approval'
  /** 鍘熷洜/鎻愮ず */
  reason?: string
}

/** 瀹¤鏃ュ織鏉＄洰 */
export interface AuditEntry {
  timestamp: number
  userId: string
  chatId: string
  tool: string
  args: unknown
  decision: PolicyDecision
}

// ============================================================================
// Policy Engine 瀹炵幇
// ============================================================================

export class PolicyEngine {
  private rules: PolicyRule[] = []
  private auditLog: AuditEntry[] = []
  private maxAuditEntries = 1000
  
  // 闇€瑕佺‘璁ょ殑 Shell 鍛戒护鍒楄〃
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
   * 娣诲姞绛栫暐瑙勫垯
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule)
  }
  
  /**
   * 璁剧疆 Shell 纭鍒楄〃
   */
  setShellConfirmList(list: string[]): void {
    this.shellConfirmList = list
  }

  /**
   * Allow common read-only shell queries by default.
   * This covers Windows PowerShell and typical Linux commands.
   */
  private isSafeReadOnlyShellCommand(command: string): boolean {
    const raw = command.trim()
    if (!raw) return false

    // Block obvious command chaining or redirection first.
    if (/[;&]|&&|\|\||`|\$\(.*\)|>>?|<</.test(raw)) {
      return false
    }

    const normalized = raw.toLowerCase()
    const safePatterns: RegExp[] = [
      // Time/date/timezone
      /^get-date(?:\s+[-\w"':.]+)*$/i,
      /^get-timezone(?:\s+[-\w"':.]+)*$/i,
      /^date(?:\s+[-+%:\w"'.]+)*$/i,
      /^timedatectl(?:\s+(?:status|show))?(?:\s+[-\w=:.]+)*$/i,
      /^hwclock(?:\s+(?:--show|-r))?(?:\s+[-\w=:.]+)*$/i,
      /^w32tm(?:\s+\/query)?(?:\s+\/status)?(?:\s+\/verbose)?$/i,
      /^tzutil\s+\/g$/i,
      // Identity/system info
      /^whoami(?:\s+\/(?:user|groups|priv))?$/i,
      /^hostname$/i,
      /^uname(?:\s+-[asnrvmpio]+)?$/i,
      /^uptime(?:\s+-(?:p|s))?$/i,
      /^get-location$/i,
      /^pwd$/i,
    ]

    return safePatterns.some((pattern) => pattern.test(normalized))
  }
  
  /**
   * 璇勪及宸ュ叿璋冪敤
   */
  async evaluate(input: {
    tool: ToolDefinition
    args: unknown
    session: SessionContext
  }): Promise<PolicyDecision> {
    const { tool, args, session } = input
    
    // 1. 妫€鏌ョ敤鎴风骇宸ュ叿鐧藉悕鍗?榛戝悕鍗?
    if (session.deniedTools?.includes(tool.name)) {
      return { type: 'deny', reason: `Tool "${tool.name}" is denied for this user` }
    }
    
    if (session.allowedTools && !session.allowedTools.includes(tool.name)) {
      return { type: 'deny', reason: `Tool "${tool.name}" is not in allowed list` }
    }
    
    // 2. 妫€鏌ヨ嚜瀹氫箟瑙勫垯
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
    
    // 3. 鍐呯疆瑙勫垯锛氬彧璇诲伐鍏疯嚜鍔ㄥ厑璁?
    const readOnlyTools = ['read', 'read_file', 'list', 'ls', 'search', 'grep', 'glob', 'view']
    if (readOnlyTools.some(t => tool.name.toLowerCase().includes(t))) {
      return { type: 'allow' }
    }
    
    // 4. 鍐呯疆瑙勫垯锛欱ash 鍛戒护妫€鏌?
    if (tool.name.toLowerCase() === 'bash' || tool.name.toLowerCase() === 'shell') {
      const command = (args as { command?: string })?.command || ''

      if (this.isSafeReadOnlyShellCommand(command)) {
        return { type: 'allow' }
      }

      const requiresConfirmation = this.shellConfirmList.some(item => command.includes(item))
      
      if (requiresConfirmation) {
        return {
          type: 'require_approval',
          prompt: `Permission Request\n\nTool: \`${tool.name}\`\nCommand:\n\`\`\`\n${command}\n\`\`\``
        }
      }
      return { type: 'allow' }
    }
    
    // 5. 鍐欏叆绫绘搷浣滈渶瑕佺‘璁?
    const writeTools = ['write', 'edit', 'delete', 'remove', 'create']
    if (writeTools.some(t => tool.name.toLowerCase().includes(t))) {
      const filePath = (args as { path?: string; file?: string })?.path || 
                       (args as { path?: string; file?: string })?.file || 
                       'unknown'
      return {
        type: 'require_approval',
        prompt: `Permission Request\n\nTool: \`${tool.name}\`\nFile: \`${filePath}\``
      }
    }
    
    // 6. 榛樿锛氶渶瑕佺‘璁?
    return {
      type: 'require_approval',
      prompt: `Permission Request\n\nTool: \`${tool.name}\`\nArgs: \`${JSON.stringify(args).slice(0, 100)}...\``
    }
  }
  
  /**
   * 璁板綍瀹¤鏃ュ織
   */
  logAudit(entry: Omit<AuditEntry, 'timestamp'>): void {
    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: Date.now()
    }
    
    this.auditLog.push(fullEntry)
    
    // 鎴柇
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAuditEntries)
    }
    
    // 鎺у埗鍙拌緭鍑?
    const status = entry.decision.type === 'allow' ? 'ALLOW' : 
                   entry.decision.type === 'deny' ? 'DENY' : 'PENDING'
    logger.info(`[Audit] ${status} User:${entry.userId} Tool:${entry.tool}`)
  }
  
  /**
   * 鑾峰彇瀹¤鏃ュ織
   */
  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(-limit)
  }
  
  /**
   * 鍖归厤宸ュ叿鍚嶇О妯″紡
   */
  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1))
    }
    return name === pattern
  }
}

// 鍗曚緥
let policyInstance: PolicyEngine | null = null

export function getPolicyEngine(): PolicyEngine {
  if (!policyInstance) {
    policyInstance = new PolicyEngine()
  }
  return policyInstance
}

