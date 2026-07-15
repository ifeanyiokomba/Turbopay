/**
 * TurboCore — Structured Logger
 * ==============================
 *
 * JSON-line logger with request-scoped tracing via AsyncLocalStorage.
 * Supports provider context, operation tagging, and error context.
 *
 * Each line: { ts, level, msg, meta?, requestId?, provider?, operation? }
 *
 * Usage:
 *   logger.info("Transfer initiated", { provider: "monnify", amount: 50000 })
 *   logger.withProvider("paystack").info("Payment verified")
 *   logger.withOperation("debit").warn("Low balance", { balance: 1000 })
 */

import { AsyncLocalStorage } from "node:async_hooks";

type Level = "info" | "warn" | "error" | "debug";

interface LogContext {
  requestId?: string;
  provider?: string;
  operation?: string;
  userId?: string;
  correlationId?: string;
}

const contextStorage = new AsyncLocalStorage<LogContext>();

/** Run `fn` with logging context in the AsyncLocalStorage. */
export function withLogContext<T>(ctx: Partial<LogContext>, fn: () => Promise<T> | T): Promise<T> | T {
  const current = contextStorage.getStore() ?? {};
  return contextStorage.run({ ...current, ...ctx }, fn);
}

/** Run `fn` with a requestId in the AsyncLocalStorage context. */
export function withRequestId<T>(id: string, fn: () => Promise<T> | T): Promise<T> | T {
  return withLogContext({ requestId: id }, fn);
}

const isProd = process.env.NODE_ENV === "production";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (level === "debug" && isProd) return;

  const ctx = contextStorage.getStore() ?? {};
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(ctx.operation ? { operation: ctx.operation } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
  });

  const stream = level === "info" || level === "debug" ? process.stdout : process.stderr;
  stream.write(line + "\n");
}

/**
 * Scoped logger — creates a logger bound to a specific provider or operation.
 * Useful for provider adapters that want all their logs tagged automatically.
 *
 * Usage:
 *   const log = logger.withProvider("monnify");
 *   log.info("Creating reserved account") // → { provider: "monnify", ... }
 */
function createScopedLogger(scope: Partial<LogContext>) {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      withLogContext(scope, () => emit("info", msg, meta));
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      withLogContext(scope, () => emit("warn", msg, meta));
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      withLogContext(scope, () => emit("error", msg, meta));
    },
    debug: (msg: string, meta?: Record<string, unknown>) => {
      withLogContext(scope, () => emit("debug", msg, meta));
    },
  };
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),

  /** Create a logger scoped to a specific provider. */
  withProvider: (provider: string) => createScopedLogger({ provider }),

  /** Create a logger scoped to a specific operation. */
  withOperation: (operation: string) => createScopedLogger({ operation }),

  /** Create a logger scoped to a specific user. */
  withUser: (userId: string) => createScopedLogger({ userId }),

  /** Create a logger with multiple context fields. */
  withContext: (ctx: Partial<LogContext>) => createScopedLogger(ctx),
};

export type Logger = typeof logger;
