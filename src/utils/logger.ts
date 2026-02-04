import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const CURRENT_LEVEL_NAME = (process.env.LOG_LEVEL?.toLowerCase() || 'info') as LogLevel
const CURRENT_LEVEL = LEVELS[CURRENT_LEVEL_NAME] ?? LEVELS.info

export class Logger {
  private static logDir: string | null = null

  constructor(private module: string) {}

  /**
   * Set the directory for log files.
   * If set, logs will be written to daily files (e.g., app-2024-03-21.log)
   */
  public static setLogDir(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true })
    }
    this.logDir = path
  }

  private format(level: string, message: string): string {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}`
  }

  private write(level: LogLevel, message: string, ...args: any[]) {
    if (CURRENT_LEVEL <= LEVELS[level]) {
      const formatted = this.format(level, message)
      const output = args.length > 0 ? `${formatted} ${JSON.stringify(args)}` : formatted
      
      // Output to console
      if (level === 'error') {
        console.error(output)
      } else if (level === 'warn') {
        console.warn(output)
      } else if (level === 'debug') {
        console.debug(output)
      } else {
        console.info(output)
      }

      // Output to file if logDir is configured
      if (Logger.logDir) {
        try {
          const date = new Date().toISOString().split('T')[0]
          const logFile = join(Logger.logDir, `app-${date}.log`)
          appendFileSync(logFile, output + '\n')
        } catch (err) {
          // Fallback if file writing fails
        }
      }
    }
  }

  debug(message: string, ...args: any[]) {
    this.write('debug', message, ...args)
  }

  info(message: string, ...args: any[]) {
    this.write('info', message, ...args)
  }

  warn(message: string, ...args: any[]) {
    this.write('warn', message, ...args)
  }

  error(message: string, ...args: any[]) {
    this.write('error', message, ...args)
  }
}
