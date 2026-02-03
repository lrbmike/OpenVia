#!/usr/bin/env bun
/**
 * OpenVia - Universal CLI Gateway for AI Agents
 *
 * Command Line Entry Point
 * v0.0.1: Initial OpenVia release
 */

import { startBot, stopBot } from './bot'
import { initRouter, handleMessage } from './orchestrator'
import { initClaudeClient, stopClaudeClient } from './ai'
import { Logger } from './utils/logger'
import { parseCLI, showHelp, showVersion, showBanner } from './cli'
import {
  loadConfig,
  initConfig,
  getDisplayConfig,
  setConfigValue,
  getConfigValue,
  getSessionsDir,
  ensureConfigDir,
  type AppConfig,
} from './config'

const logger = new Logger('App')

/** Global Configuration */
let config: AppConfig

/**
 * Start Bot Command
 */
async function startBotCommand(): Promise<void> {
  // Ensure config directory exists (sessions directory needed)
  ensureConfigDir()

  const token = config.telegram.botToken
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN is not set')
    logger.info('Please set it via:')
    logger.info('  - Environment variable: TELEGRAM_BOT_TOKEN=xxx')
    logger.info('  - Config file: openvia config set telegram.botToken xxx')
    process.exit(1)
  }

  showBanner()

  if (config.logging.verbose) {
    logger.info('Verbose mode enabled')
    logger.info(`Config: ${JSON.stringify(getDisplayConfig(), null, 2)}`)
  }

  logger.info('Initializing...')

  // Initialize Claude Client
  const sessionsDir = getSessionsDir()
  await initClaudeClient(config.claude, sessionsDir)

  // Initialize Router
  await initRouter({
    workDir: sessionsDir,
    maxSteps: 5,
    timeout: config.claude.timeout,
  })

  // Start Telegram Bot
  await startBot(token, handleMessage)
}

/**
 * Initialize Configuration Command
 */
function initCommand(): void {
  const result = initConfig()

  if (result.created) {
    console.log('✓ Configuration initialized successfully!')
    console.log(`  Config file: ${result.path}`)
    console.log('')
    console.log('Next steps:')
    console.log('  1. Set your Telegram Bot Token:')
    console.log('     export TELEGRAM_BOT_TOKEN="your-token"')
    console.log('     # or')
    console.log('     openvia config set telegram.botToken "your-token"')
    console.log('')
    console.log('  2. Start the bot:')
    console.log('     openvia')
  } else {
    console.log('Configuration already exists.')
    console.log(`  Config file: ${result.path}`)
  }
}

/**
 * Configuration Management Command
 */
function configCommand(args: string[]): void {
  if (args.length === 0) {
    // Show current configuration
    const displayConfig = getDisplayConfig()
    console.log('Current configuration:')
    console.log(JSON.stringify(displayConfig, null, 2))
    return
  }

  const subCommand = args[0]

  switch (subCommand) {
    case 'set':
      if (args.length < 3) {
        console.error('Usage: openvia config set <key> <value>')
        console.error('Example: openvia config set claude.timeout 60000')
        process.exit(1)
      }
      setConfigValue(args[1], args[2])
      console.log(`✓ Set ${args[1]} = ${args[2]}`)
      break

    case 'get':
      if (args.length < 2) {
        console.error('Usage: openvia config get <key>')
        console.error('Example: openvia config get claude.timeout')
        process.exit(1)
      }
      const value = getConfigValue(args[1])
      if (value === undefined) {
        console.log(`${args[1]}: (not set)`)
      } else {
        console.log(`${args[1]}: ${JSON.stringify(value)}`)
      }
      break

    default:
      console.error(`Unknown config subcommand: ${subCommand}`)
      console.error('Available: set, get')
      process.exit(1)
  }
}

/**
 * Graceful Shutdown
 */
async function shutdown(): Promise<void> {
  logger.info('Shutting down...')
  await stopBot()
  stopClaudeClient()
  logger.info('Goodbye!')
  process.exit(0)
}

/**
 * Main Entry Point
 */
async function main(): Promise<void> {
  // Parse CLI
  const cli = parseCLI()

  // Load Config
  config = loadConfig(cli.options)

  // Dispatch based on command
  switch (cli.command) {
    case 'help':
      showHelp()
      break

    case 'version':
      showVersion()
      break

    case 'init':
      initCommand()
      break

    case 'config':
      configCommand(cli.args)
      break

    case 'start':
    default:
      // Handle exit signals
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      await startBotCommand()
      break
  }
}

// Start application
main().catch((error) => {
  logger.error('Fatal error:', error)
  process.exit(1)
})
