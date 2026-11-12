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

/**
 * API error - error from the EMR API
 */
export class ApiError extends ChartingHeroError {
  public readonly apiStatusCode?: number;

  constructor(message: string, apiStatusCode?: number) {
    super(message, 'API_ERROR', 502);
    this.name = 'ApiError';
    this.apiStatusCode = apiStatusCode;
  }
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
 * Format error for MCP tool response
 */
export function formatErrorForMcp(error: unknown): { type: 'text'; text: string } {
  if (error instanceof ChartingHeroError) {
    return {
      type: 'text',
      text: `Error [${error.code}]: ${error.message}`,
    };
  }

  if (error instanceof Error) {
    return {
      type: 'text',
      text: `Error: ${error.message}`,
    };
  }

  return {
    type: 'text',
    text: 'An unknown error occurred',
  };
}
