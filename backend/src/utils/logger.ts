import { config } from '../config';

/**
 * Structured JSON logger. Deliberately dependency-free: one line of JSON per event to
 * stdout, which any log shipper can ingest, and no transport/worker machinery to
 * misconfigure.
 */

type Level = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_WEIGHT: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVEL_WEIGHT[config.logLevel] ?? LEVEL_WEIGHT.info;

export interface LogContext {
  requestId?: string;
  userId?: string;
  deviceId?: string;
  [key: string]: unknown;
}

/** Never let these reach the log stream, wherever they appear in a context object. */
const REDACTED_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'password_hash',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'token_hash',
  'tokenhash',
  'authorization',
  'pushtoken',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(entry, depth + 1);
  }
  return output;
}

function serialiseError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // Stacks are noise in production log aggregation but essential locally.
      ...(config.isProduction ? {} : { stack: error.stack }),
      ...(error.cause !== undefined ? { cause: String(error.cause) } : {}),
    };
  }
  return { message: String(error) };
}

function emit(level: Level, message: string, context?: LogContext, error?: unknown): void {
  if (LEVEL_WEIGHT[level] > threshold) return;

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
    ...(error !== undefined ? { err: serialiseError(error) } : {}),
  };

  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  error: (message: string, context?: LogContext, error?: unknown): void =>
    emit('error', message, context, error),
  warn: (message: string, context?: LogContext, error?: unknown): void =>
    emit('warn', message, context, error),
  info: (message: string, context?: LogContext): void => emit('info', message, context),
  debug: (message: string, context?: LogContext): void => emit('debug', message, context),

  /** Returns a logger that merges `base` into every record. */
  child(base: LogContext) {
    return {
      error: (message: string, context?: LogContext, error?: unknown): void =>
        emit('error', message, { ...base, ...context }, error),
      warn: (message: string, context?: LogContext, error?: unknown): void =>
        emit('warn', message, { ...base, ...context }, error),
      info: (message: string, context?: LogContext): void =>
        emit('info', message, { ...base, ...context }),
      debug: (message: string, context?: LogContext): void =>
        emit('debug', message, { ...base, ...context }),
    };
  },
};

export type Logger = typeof logger;
