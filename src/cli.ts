/**
 * CLI Command Parsing Module
 *
 * Provides command-line argument parsing and help information display.
 */

import { version } from '../package.json'
import { Logger } from './utils/logger'

const logger = new Logger('CLI')

/** CLI Command Types */
export type CLICommand = 'start' | 'init' | 'config' | 'help' | 'version'

/** Parsed CLI Result Interface */
export interface ParsedCLI {
  command: CLICommand
  args: string[]
  options: {
    timeout?: number
    model?: string
    verbose?: boolean
    configPath?: string
    help?: boolean
    version?: boolean
  }
}

/** Help Information Text */
const HELP_TEXT = `
OpenVia - Universal, Extensible CLI Gateway for AI Agents

Usage:
  openvia [command] [options]

Commands:
  start          Start the Bot (Default command)
  init           Initialize configuration directory and files
  config         View current configuration
  config set     Set configuration item, format: openvia config set <key> <value>
  config get     Get configuration item, format: openvia config get <key>
  help           Display help information
  version        Display version number

Options:
  -t, --timeout <ms>     Set request timeout (milliseconds)
  -m, --model <name>     Set Claude model
  -v, --verbose          Enable verbose logging mode
  -c, --config <path>    Specify configuration file path
  -h, --help             Display help information
  --version              Display version number

Examples:
  openvia                        Start the Bot
  openvia init                   Initialize configuration
  openvia config                 View configuration
  openvia config set claude.timeout 60000
  openvia config get claude.model
  openvia --timeout 60000 -v     Start with custom options

Environment Variables:
  TELEGRAM_BOT_TOKEN       Telegram Bot Token
  ANTHROPIC_API_KEY        Anthropic API Key
  CLAUDE_MODEL             Claude model name
  CLAUDE_TIMEOUT           Timeout value (milliseconds)
  LOG_LEVEL                Logging level (debug|info|warn|error)

Configuration:
  Default location: ~/.openvia/config.json
  Run 'openvia init' to create a default configuration file.

Documentation:
  https://github.com/lrbmike/claude-code-bot (OpenVia)
`

/**
 * Parse Command Line Arguments
 */
export function parseCLI(argv: string[] = process.argv): ParsedCLI {
  const args = argv.slice(2)

  const result: ParsedCLI = {
    command: 'start',
    args: [],
    options: {},
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg.startsWith('-')) {
      switch (arg) {
        case '-h':
        case '--help':
          result.options.help = true
          result.command = 'help'
          break

        case '--version':
          result.options.version = true
          result.command = 'version'
          break

        case '-v':
        case '--verbose':
          result.options.verbose = true
          break

        case '-t':
        case '--timeout':
          if (args[i + 1]) {
            const timeout = parseInt(args[i + 1], 10)
            if (!isNaN(timeout)) {
              result.options.timeout = timeout
              i++
            }
          }
          break

        case '-m':
        case '--model':
          if (args[i + 1]) {
            result.options.model = args[i + 1]
            i++
          }
          break

        case '-c':
        case '--config':
          if (args[i + 1]) {
            result.options.configPath = args[i + 1]
            i++
          }
          break
      }
    } else {
      switch (arg) {
        case 'start':
          result.command = 'start'
          break

        case 'init':
          result.command = 'init'
          break

        case 'config':
          result.command = 'config'
          while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
            result.args.push(args[i + 1])
            i++
          }
          break

        case 'help':
          result.command = 'help'
          break

        case 'version':
          result.command = 'version'
          break

        default:
          result.args.push(arg)
      }
    }

    i++
  }

  return result
}

/**
 * Display help information
 */
export function showHelp(): void {
  logger.info(HELP_TEXT)
}

/**
 * Display version information
 */
export function showVersion(): void {
  logger.info(`OpenVia v${version}`)
}

/**
 * Display startup banner
 */
export function showBanner(): void {
  logger.info('='.repeat(50))
  logger.info(`  OpenVia v${version}`)
  logger.info('  Universal CLI Gateway for AI Agents')
  logger.info('  Mode: Claude ACP (JSON-RPC)')
  logger.info('='.repeat(50))
}

