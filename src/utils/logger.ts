/**
 * Logger utility for ChartingHero MCP server
 *
 * IMPORTANT: This logger is designed to NEVER log PHI (Protected Health Information).
 * All patient data must be sanitized before logging.
 */

import { getConfig } from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Sanitize data to remove any potential PHI before logging
 */
function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Mask anything that looks like a patient ID
    return data.replace(/PT-\d+/g, 'PT-[REDACTED]');
  }

  if (Array.isArray(data)) {
    return data.map(sanitize);
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields entirely
      const sensitiveFields = [
        'name', 'firstName', 'lastName', 'patientName',
        'phone', 'phoneNumber', 'email', 'address',
        'ssn', 'socialSecurity', 'dob', 'dateOfBirth',
        'diagnosis', 'condition', 'medication', 'note', 'notes',
      ];

      if (sensitiveFields.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (key.toLowerCase().includes('patient') && typeof value === 'object') {
        sanitized[key] = '[PATIENT_DATA_REDACTED]';
      } else {
        sanitized[key] = sanitize(value);
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * Format log message for output
 */
function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [CHARTINGHERO] [${level.toUpperCase()}]`;

  if (data !== undefined) {
    const sanitizedData = sanitize(data);
    return `${prefix} ${message} ${JSON.stringify(sanitizedData)}`;
  }

  return `${prefix} ${message}`;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  const config = getConfig();
  return LOG_LEVELS[level] >= LOG_LEVELS[config.logLevel];
}

/**
 * Logger interface - outputs to stderr to not interfere with MCP stdio transport
 */
export const logger = {
  debug(message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.error(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.error(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.error(formatMessage('warn', message, data));
    }
  },

  error(message: string, data?: unknown): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },

  /**
   * Log an operation without any data (safe for audit trails)
   */
  audit(operation: string, success: boolean, durationMs?: number): void {
    const msg = `AUDIT: ${operation} - ${success ? 'SUCCESS' : 'FAILURE'}${durationMs ? ` (${durationMs}ms)` : ''}`;
    console.error(formatMessage('info', msg));
  },
};
