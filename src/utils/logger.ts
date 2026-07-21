// TurboPay Structured Logger
// JSON-formatted logging with correlation IDs, levels, and optional Sentry integration

// =============================================================================
// TYPES
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  provider?: string;
  operation?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  duration_ms?: number;
}

// =============================================================================
// LOGGER CONFIG
// =============================================================================

export interface LoggerConfig {
  minLevel: LogLevel;
  enableConsole: boolean;
  enableSentry: boolean;
  sentryDsn?: string;
  environment: string;
  service: string;
}

// =============================================================================
// LOG LEVELS
// =============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
};

// =============================================================================
// STRUCTURED LOGGER
// =============================================================================

export class Logger {
  private config: LoggerConfig;
  private sentryInitialized = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
      enableConsole: true,
      enableSentry: false,
      environment: process.env.NODE_ENV || 'development',
      service: 'turbopay-api',
      ...config
    };

    if (this.config.enableSentry && this.config.sentryDsn) {
      this.initSentry();
    }
  }

  // ===========================================================================
  // SENTRY INITIALIZATION
  // ===========================================================================

  private initSentry(): void {
    try {
      // Dynamic import to avoid requiring Sentry when not configured
      const Sentry = require('@sentry/node');
      Sentry.init({
        dsn: this.config.sentryDsn,
        environment: this.config.environment,
        tracesSampleRate: this.config.environment === 'production' ? 0.1 : 1.0,
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }),
        ],
      });
      this.sentryInitialized = true;
      console.log('[Logger] Sentry initialized');
    } catch (error) {
      console.warn('[Logger] Sentry not available, error tracking disabled');
    }
  }

  // ===========================================================================
  // CORE LOGGING METHODS
  // ===========================================================================

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorObj = this.normalizeError(error);
    this.log('error', message, context, errorObj);

    // Send to Sentry
    if (this.sentryInitialized && errorObj) {
      this.sendToSentry('error', message, errorObj, context);
    }
  }

  fatal(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorObj = this.normalizeError(error);
    this.log('fatal', message, context, errorObj);

    // Send to Sentry
    if (this.sentryInitialized && errorObj) {
      this.sendToSentry('fatal', message, errorObj, context);
    }
  }

  // ===========================================================================
  // REQUEST SCOPED LOGGING
  // ===========================================================================

  child(context: LogContext): Logger {
    const childLogger = new Logger(this.config);
    childLogger.setContext(context);
    return childLogger;
  }

  private baseContext: LogContext = {};

  private setContext(context: LogContext): void {
    this.baseContext = { ...this.baseContext, ...context };
  }

  // ===========================================================================
  // PERFORMANCE LOGGING
  // ===========================================================================

  startTimer(label: string): { end: () => number } {
    const start = Date.now();
    return {
      end: () => {
        const duration = Date.now() - start;
        this.info(`${label} completed`, { duration_ms: duration });
        return duration;
      }
    };
  }

  logDuration(operation: string, durationMs: number, context?: LogContext): void {
    this.info(`${operation} completed`, { ...context, duration_ms: durationMs });
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: { name: string; message: string; stack?: string; code?: string }
  ): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...context },
      error
    };

    if (this.config.enableConsole) {
      this.consoleOutput(entry);
    }
  }

  private consoleOutput(entry: LogEntry): void {
    const { timestamp, level, message, context, error } = entry;

    // Format for console readability
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const contextStr = context && Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : '';

    switch (level) {
      case 'debug':
        console.debug(`${prefix} ${message}${contextStr}`);
        break;
      case 'info':
        console.info(`${prefix} ${message}${contextStr}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}${contextStr}`);
        break;
      case 'error':
      case 'fatal':
        console.error(`${prefix} ${message}${contextStr}`);
        if (error?.stack) {
          console.error(error.stack);
        }
        break;
    }
  }

  private normalizeError(error: Error | unknown): { name: string; message: string; stack?: string; code?: string } | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }

    if (typeof error === 'string') {
      return {
        name: 'Error',
        message: error
      };
    }

    return {
      name: 'UnknownError',
      message: JSON.stringify(error)
    };
  }

  private sendToSentry(
    level: 'error' | 'fatal',
    message: string,
    error: { name: string; message: string; stack?: string; code?: string },
    context?: LogContext
  ): void {
    try {
      const Sentry = require('@sentry/node');
      Sentry.withScope((scope: any) => {
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            scope.setTag(key, String(value));
          });
        }
        scope.setLevel(level);
        Sentry.captureException(new Error(`${message}: ${error.message}`));
      });
    } catch (e) {
      // Sentry not available — silently fail
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger({
      enableSentry: !!process.env.SENTRY_DSN,
      sentryDsn: process.env.SENTRY_DSN
    });
  }
  return loggerInstance;
}

export default Logger;
