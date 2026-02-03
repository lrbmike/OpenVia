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
  constructor(private module: string) {}

  private format(level: string, message: string): string {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}`
  }

  debug(message: string, ...args: any[]) {
    if (CURRENT_LEVEL <= LEVELS.debug) {
      console.debug(this.format('debug', message), ...args)
    }
  }

  info(message: string, ...args: any[]) {
    if (CURRENT_LEVEL <= LEVELS.info) {
      console.info(this.format('info', message), ...args)
    }
  }

  warn(message: string, ...args: any[]) {
    if (CURRENT_LEVEL <= LEVELS.warn) {
      console.warn(this.format('warn', message), ...args)
    }
  }

  error(message: string, ...args: any[]) {
    if (CURRENT_LEVEL <= LEVELS.error) {
      console.error(this.format('error', message), ...args)
    }
  }
}
