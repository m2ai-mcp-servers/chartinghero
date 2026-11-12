/**
 * Logger for the ChartingHero MCP server. Writes to stderr so it never touches the
 * MCP stdio transport.
 *
 * PHI safety is an allowlist, not a denylist: a data value is emitted only if its key
 * is in LOGGABLE_KEYS and the value matches that key's shape; anything else becomes
 * "[REDACTED]". Messages pass through redact(). Messages should be literals; redact()
 * is the backstop for identifiers that slip into one.
 */

import { createHash } from 'node:crypto';

import { getConfig } from '../config.js';
import type { LogLevel } from '../config.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * The only data keys a log line may carry, each with the exact shape its value must
 * have. A value that does not match is emitted as "[REDACTED]". Shape checks (not
 * redact()) keep structured values intact: a hex hash or a SQLSTATE is not an identifier.
 */
const NUMBER = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const shape = (re: RegExp) => (v: unknown): boolean => typeof v === 'string' && re.test(v);

export const LOGGABLE_KEYS: ReadonlyMap<string, (v: unknown) => boolean> = new Map([
  ['tool', shape(/^[a-z_]{1,40}$/)],
  ['requestId', shape(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)],
  ['durationMs', NUMBER],
  ['status', shape(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)],
  ['httpStatus', NUMBER],
  ['resourceType', shape(/^[A-Z][A-Za-z]{1,39}$/)],
  ['count', NUMBER],
  ['visitIdHash', shape(/^[0-9a-f]{12}$/)],
]);

export const REDACTED = '[REDACTED]';

/** Ordered: specific identifier shapes first, then any remaining long digit run. */
const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED], // email
  [/\b([A-Z][A-Za-z]+)\/[A-Za-z0-9\-.]{1,64}/g, `$1/${REDACTED}`], // FHIR reference, e.g. Patient/123
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, REDACTED], // UUID
  [/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, REDACTED], // ISO date or timestamp
  [/\b[A-Z]{2,4}-\d+\b/g, REDACTED], // local ids: PT-10001, MRN-001, VN-20001
  [/\(?\b\d{3}\)?[-.\s]\d{3,4}(?:[-.\s]\d{4})?\b/g, REDACTED], // phone numbers
  [/\d{4,}/g, REDACTED], // any other long digit run
];

export function redact(text: string): string {
  return REDACTIONS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), text);
}

/** Short one-way hash so a visit can be correlated across log lines without its id. */
export function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

export function sanitizeData(data: unknown): Record<string, unknown> | string {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return REDACTED;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const valid = LOGGABLE_KEYS.get(key);
    out[key] = value === undefined ? null : valid && valid(value) ? value : REDACTED;
  }
  return out;
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const prefix = `[${new Date().toISOString()}] [CHARTINGHERO] [${level.toUpperCase()}]`;
  const line = `${prefix} ${redact(message)}`;
  return data === undefined ? line : `${line} ${JSON.stringify(sanitizeData(data))}`;
}

function shouldLog(level: LogLevel): boolean {
  let threshold: LogLevel = 'info';
  try {
    threshold = getConfig().logLevel;
  } catch {
    // Invalid config: startup reports it and exits; log at info until then.
  }
  return LOG_LEVELS[level] >= LOG_LEVELS[threshold];
}

function emit(level: LogLevel, message: string, data?: unknown): void {
  if (shouldLog(level)) console.error(formatMessage(level, message, data));
}

export const logger = {
  debug: (message: string, data?: unknown): void => emit('debug', message, data),
  info: (message: string, data?: unknown): void => emit('info', message, data),
  warn: (message: string, data?: unknown): void => emit('warn', message, data),
  error: (message: string, data?: unknown): void => emit('error', message, data),

  /** Audit trail entry. Always emitted, regardless of LOG_LEVEL. */
  audit(operation: string, success: boolean, durationMs?: number): void {
    const msg = `AUDIT: ${operation} - ${success ? 'SUCCESS' : 'FAILURE'}`;
    console.error(formatMessage('info', msg, durationMs === undefined ? undefined : { durationMs }));
  },
};
