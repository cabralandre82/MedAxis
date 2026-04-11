/**
 * Structured logger for Clinipharma.
 *
 * Outputs JSON-formatted logs with consistent fields for observability.
 * Compatible with Vercel Log Drains (send to Logtail/Datadog/etc via drain URL).
 *
 * Fields per log entry:
 *   level, message, timestamp, requestId?, userId?, action?, durationMs?, error?, [context]
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  requestId?: string
  userId?: string
  action?: string
  entityType?: string
  entityId?: string
  durationMs?: number
  statusCode?: number
  path?: string
  [key: string]: unknown
}

interface LogEntry extends LogContext {
  level: LogLevel
  message: string
  timestamp: string
  env: string
}

function buildEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV ?? 'development',
    ...context,
  }
}

function output(entry: LogEntry): void {
  const line = JSON.stringify(entry)
  switch (entry.level) {
    case 'error':
      console.error(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'debug':
      if (process.env.NODE_ENV !== 'production') console.debug(line)
      break
    default:
      console.log(line)
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    output(buildEntry('debug', message, context))
  },

  info(message: string, context?: LogContext): void {
    output(buildEntry('info', message, context))
  },

  warn(message: string, context?: LogContext): void {
    output(buildEntry('warn', message, context))
  },

  error(message: string, context?: LogContext & { error?: unknown }): void {
    const { error, ...rest } = context ?? {}
    const errorContext: LogContext = { ...rest }

    if (error instanceof Error) {
      errorContext.errorMessage = error.message
      errorContext.errorStack = error.stack
      errorContext.errorName = error.name
    } else if (error !== undefined) {
      errorContext.errorRaw = String(error)
    }

    output(buildEntry('error', message, errorContext))
  },

  /** Returns a child logger with fixed context (e.g. per-request requestId). */
  child(fixedContext: LogContext) {
    return {
      debug: (message: string, ctx?: LogContext) =>
        logger.debug(message, { ...fixedContext, ...ctx }),
      info: (message: string, ctx?: LogContext) =>
        logger.info(message, { ...fixedContext, ...ctx }),
      warn: (message: string, ctx?: LogContext) =>
        logger.warn(message, { ...fixedContext, ...ctx }),
      error: (message: string, ctx?: LogContext & { error?: unknown }) =>
        logger.error(message, { ...fixedContext, ...ctx }),
    }
  },
}

export type Logger = typeof logger
export type ChildLogger = ReturnType<typeof logger.child>
