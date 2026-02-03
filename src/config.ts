/**
 * Configuration Management Module
 *
 * Provides cross-platform configuration directory management, loading, and saving functionality.
 * Priority: CLI Arguments > Environment Variables > config.json > Default Values
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** Application Name */
const APP_NAME = 'openvia'

/** Configuration Filename */
const CONFIG_FILE = 'config.json'

/** Application Configuration Type */
export interface AppConfig {
  telegram: {
    botToken: string
    allowedUserIds: number[]
  }
  claude: {
    apiKey: string
    baseUrl: string
    model: string
    timeout: number
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
    shellWhitelist: string[]
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    verbose: boolean
  }
}

/** CLI Options Type */
export interface CLIOptions {
  timeout?: number
  model?: string
  verbose?: boolean
  configPath?: string
}

/**
 * Get Default Configuration
 */
export function getDefaultConfig(): AppConfig {
  return {
    telegram: {
      botToken: '',
      allowedUserIds: [],
    },
    claude: {
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5-20250929',
      timeout: 120000,
      permissionMode: 'default',
      shellWhitelist: ['ls', 'cat', 'pwd', 'git status', 'echo'],
    },
    logging: {
      level: 'info',
      verbose: false,
    },
  }
}

/**
 * Get Configuration Directory Path (Cross-platform)
 *
 * - Linux: ~/.openvia/ or $XDG_CONFIG_HOME/openvia/
 * - macOS: ~/.openvia/
 * - Windows: %USERPROFILE%\.openvia\
 */
export function getConfigDir(): string {
  const platform = process.platform

  if (platform === 'linux') {
    const xdgConfig = process.env.XDG_CONFIG_HOME
    if (xdgConfig) {
      return join(xdgConfig, APP_NAME)
    }
  }

  return join(homedir(), `.${APP_NAME}`)
}

/**
 * Get Configuration File Path
 */
export function getConfigFilePath(customPath?: string): string {
  if (customPath) {
    return customPath
  }
  return join(getConfigDir(), CONFIG_FILE)
}

/**
 * Get Sessions Directory Path
 */
export function getSessionsDir(): string {
  return join(getConfigDir(), 'sessions')
}

/**
 * Get Logs Directory Path
 */
export function getLogsDir(): string {
  return join(getConfigDir(), 'logs')
}

/**
 * Ensure Configuration Directory Structure Exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir()
  const sessionsDir = getSessionsDir()
  const logsDir = getLogsDir()

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true })
  }
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }
}

/**
 * Load Configuration from File
 */
function loadConfigFromFile(configPath?: string): Partial<AppConfig> {
  const filePath = getConfigFilePath(configPath)

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as Partial<AppConfig>
  } catch (error) {
    console.warn(`Warning: Failed to parse config file: ${filePath}`)
    return {}
  }
}

/**
 * Load Configuration from Environment Variables
 */
function loadConfigFromEnv(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {
    telegram: {
      botToken: '',
      allowedUserIds: [],
    },
    claude: {
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5-20250929',
      timeout: 120000,
      permissionMode: 'default',
      shellWhitelist: [],
    },
    logging: {
      level: 'info',
      verbose: false,
    },
  }

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    config.telegram!.botToken = process.env.TELEGRAM_BOT_TOKEN
  }
  if (process.env.ALLOWED_USER_IDS) {
    config.telegram!.allowedUserIds = process.env.ALLOWED_USER_IDS.split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id))
  }

  // Claude
  if (process.env.ANTHROPIC_API_KEY) {
    config.claude!.apiKey = process.env.ANTHROPIC_API_KEY
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    config.claude!.baseUrl = process.env.ANTHROPIC_BASE_URL
  }
  if (process.env.CLAUDE_MODEL) {
    config.claude!.model = process.env.CLAUDE_MODEL
  }
  if (process.env.CLAUDE_TIMEOUT) {
    const timeout = parseInt(process.env.CLAUDE_TIMEOUT, 10)
    if (!isNaN(timeout)) {
      config.claude!.timeout = timeout
    }
  }
  if (process.env.CLAUDE_PERMISSION_MODE) {
    const mode = process.env.CLAUDE_PERMISSION_MODE as AppConfig['claude']['permissionMode']
    if (['default', 'acceptEdits', 'bypassPermissions'].includes(mode)) {
      config.claude!.permissionMode = mode
    }
  }
  if (process.env.SHELL_WHITELIST) {
    config.claude!.shellWhitelist = process.env.SHELL_WHITELIST.split(',').map((cmd) => cmd.trim())
  }

  // Logging
  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL as AppConfig['logging']['level']
    if (['debug', 'info', 'warn', 'error'].includes(level)) {
      config.logging!.level = level
    }
  }
  if (process.env.OPENVIA_VERBOSE === 'true') {
    config.logging!.verbose = true
  }

  return config
}

/**
 * Deep merge configuration objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target }

  for (const key in source) {
    const sourceValue = source[key]
    if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
      if (
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        sourceValue !== null
      ) {
        result[key] = deepMerge(result[key] || {}, sourceValue)
      } else if (Array.isArray(sourceValue) && sourceValue.length > 0) {
        result[key] = sourceValue
      } else if (!Array.isArray(sourceValue)) {
        result[key] = sourceValue
      }
    }
  }

  return result
}

/**
 * Load Full Configuration
 *
 * Priority: CLI Arguments > Environment Variables > config.json > Default Values
 */
export function loadConfig(cliOptions?: CLIOptions): AppConfig {
  // 1. Start with defaults
  let config = getDefaultConfig()

  // 2. Merge configuration file
  const fileConfig = loadConfigFromFile(cliOptions?.configPath)
  config = deepMerge(config, fileConfig)

  // 3. Merge environment variables
  const envConfig = loadConfigFromEnv()
  config = deepMerge(config, envConfig)

  // 4. Merge CLI options (Highest priority)
  if (cliOptions) {
    if (cliOptions.timeout !== undefined) {
      config.claude.timeout = cliOptions.timeout
    }
    if (cliOptions.model !== undefined) {
      config.claude.model = cliOptions.model
    }
    if (cliOptions.verbose !== undefined) {
      config.logging.verbose = cliOptions.verbose
    }
  }

  return config
}

/**
 * Save configuration to file
 */
export function saveConfig(config: Partial<AppConfig>, configPath?: string): void {
  ensureConfigDir()

  const filePath = getConfigFilePath(configPath)

  // Load existing config
  const existingConfig = loadConfigFromFile(configPath)

  // Merge new config
  const mergedConfig = deepMerge(existingConfig, config)

  // Save
  writeFileSync(filePath, JSON.stringify(mergedConfig, null, 2), 'utf-8')
}

/**
 * Initialize Configuration (Creates default config file)
 */
export function initConfig(): { created: boolean; path: string } {
  ensureConfigDir()

  const filePath = getConfigFilePath()

  if (existsSync(filePath)) {
    return { created: false, path: filePath }
  }

  // Create default configuration (sensitive fields empty)
  const defaultConfig = getDefaultConfig()
  writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2), 'utf-8')

  return { created: true, path: filePath }
}

/**
 * Set configuration value (Supports dot-separated paths like "claude.timeout")
 */
export function setConfigValue(key: string, value: string): void {
  const config = loadConfigFromFile() as Record<string, any>
  const keys = key.split('.')

  let current = config
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {}
    }
    current = current[keys[i]]
  }

  const lastKey = keys[keys.length - 1]
  let parsedValue: any = value

  // Parse numeric values
  if (/^\d+$/.test(value)) {
    parsedValue = parseInt(value, 10)
  }
  // Parse boolean values
  else if (value === 'true') {
    parsedValue = true
  } else if (value === 'false') {
    parsedValue = false
  }
  // Parse arrays (comma separated)
  else if (value.includes(',')) {
    parsedValue = value.split(',').map((v) => v.trim())
  }

  current[lastKey] = parsedValue

  saveConfig(config as Partial<AppConfig>)
}

/**
 * Get configuration value (Supports dot-separated paths)
 */
export function getConfigValue(key: string): any {
  const config = loadConfig() as Record<string, any>
  const keys = key.split('.')

  let current = config
  for (const k of keys) {
    if (current[k] === undefined) {
      return undefined
    }
    current = current[k]
  }

  return current
}

/**
 * Get displayable configuration (Masks sensitive information)
 */
export function getDisplayConfig(): AppConfig {
  const config = loadConfig()

  // Mask sensitive information
  if (config.telegram.botToken) {
    config.telegram.botToken = config.telegram.botToken.slice(0, 10) + '****'
  }
  if (config.claude.apiKey) {
    config.claude.apiKey = config.claude.apiKey.slice(0, 15) + '****'
  }

  return config
}
