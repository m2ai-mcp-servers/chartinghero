/**
 * Custom error classes for ChartingHero MCP server
 *
 * Errors are designed to be informative without exposing PHI.
 */

/**
 * Base error class for ChartingHero
 */
export class ChartingHeroError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = 'ChartingHeroError';
    this.code = code;
    this.statusCode = statusCode;
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * Configuration error - missing or invalid configuration
 */
export class ConfigurationError extends ChartingHeroError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}

/**
 * Authentication error - API auth failed
 */
export class AuthenticationError extends ChartingHeroError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Not found error - resource not found
 */
export class NotFoundError extends ChartingHeroError {
  constructor(resource: string) {
    // Don't include specific identifiers in error message
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error - invalid input
 */
export class ValidationError extends ChartingHeroError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
    };
  }
}

/** FHIR R4 IssueType value set (closed). Anything else from upstream is dropped. */
const ISSUE_TYPES: ReadonlySet<string> = new Set([
  'invalid', 'structure', 'required', 'value', 'invariant', 'security', 'login', 'unknown',
  'expired', 'forbidden', 'suppressed', 'processing', 'not-supported', 'duplicate',
  'multiple-matches', 'not-found', 'deleted', 'too-long', 'code-invalid', 'extension',
  'too-costly', 'business-rule', 'conflict', 'transient', 'lock-error', 'no-store',
  'exception', 'timeout', 'incomplete', 'throttled', 'informational',
]);

/**
 * API error - an upstream (EMR or dashboard) request failed.
 *
 * Carries only the HTTP status and the OperationOutcome issue codes (a fixed FHIR
 * vocabulary such as "processing" or "not-found"). Upstream diagnostics, details
 * and response text are never stored, so they cannot reach a log or a tool result.
 */
export class ApiError extends ChartingHeroError {
  public readonly httpStatus?: number;
  public readonly issueCodes: readonly string[];

  constructor(httpStatus?: number, issueCodes: readonly string[] = []) {
    const codes = issueCodes.filter((c) => ISSUE_TYPES.has(c));
    const detail = [httpStatus !== undefined ? `HTTP ${httpStatus}` : '', codes.join(', ')]
      .filter(Boolean)
      .join(': ');
    super(`Upstream request failed${detail ? ` (${detail})` : ''}`, 'API_ERROR', 502);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.issueCodes = codes;
  }

  /** Build from an OperationOutcome body, keeping issue[].code only. */
  static fromOperationOutcome(httpStatus: number | undefined, body: unknown): ApiError {
    const issues = isOperationOutcome(body) && Array.isArray(body.issue) ? body.issue : [];
    const codes = issues
      .map((i: unknown) => (i && typeof i === 'object' ? (i as { code?: unknown }).code : undefined))
      .filter((c: unknown): c is string => typeof c === 'string');
    return new ApiError(httpStatus, codes);
  }
}

function isOperationOutcome(value: unknown): value is { resourceType: 'OperationOutcome'; issue?: unknown } {
  return !!value && typeof value === 'object' && (value as { resourceType?: unknown }).resourceType === 'OperationOutcome';
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends ChartingHeroError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Mock mode indicator - not a real error, used to indicate mock response
 */
export class MockModeNotice extends ChartingHeroError {
  constructor() {
    super('Running in mock mode - no real API calls made', 'MOCK_MODE', 200);
    this.name = 'MockModeNotice';
  }
}

/**
 * Format an error for an MCP tool result.
 *
 * Only ChartingHeroError messages are shown: they are written by this codebase and
 * carry no upstream text. A raw OperationOutcome is reduced to its issue codes. Any
 * other error is reported by class name only, because its message may echo an
 * upstream response or patient data.
 */
export function formatErrorForMcp(error: unknown): { type: 'text'; text: string } {
  if (isOperationOutcome(error)) error = ApiError.fromOperationOutcome(undefined, error);

  if (error instanceof ChartingHeroError) {
    return { type: 'text', text: `Error [${error.code}]: ${error.message}` };
  }

  if (error instanceof Error) {
    return { type: 'text', text: `Error [INTERNAL]: unexpected ${safeName(error)}` };
  }

  return { type: 'text', text: 'Error [INTERNAL]: an unknown error occurred' };
}

/** An Error's class name, if it looks like one; never free text. */
function safeName(error: Error): string {
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : 'Error';
}

/** Allowlisted log fields describing an error, never its message. */
export function errorLogFields(error: unknown): { status: string; httpStatus?: number } {
  if (error instanceof ApiError) return { status: error.code, httpStatus: error.httpStatus };
  if (error instanceof ChartingHeroError) return { status: error.code };
  if (error instanceof Error) return { status: safeName(error) };
  return { status: 'UNKNOWN' };
}
