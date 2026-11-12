/**
 * PHI-safe logging and error surface (PR3).
 * All values here are synthetic.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { hashId, logger, redact, sanitizeData } from '../src/utils/logger.js';
import { ApiError, ValidationError, formatErrorForMcp, errorLogFields } from '../src/utils/errors.js';
import { resetConfig } from '../src/config.js';

let lines: string[] = [];
let spy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  resetConfig();
  lines = [];
  spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  spy.mockRestore();
});

const PHI = {
  firstName: 'Eleanor',
  dateOfBirth: '1940-01-01',
  subjective: 'pain',
  patientId: '12345',
  id: '0b6f4c1e-uuid',
};

describe('logger allowlist', () => {
  test('none of the PHI values reach stderr, from data or message', () => {
    logger.info('Fetched Patient/12345 for review', PHI);
    logger.warn('Fetched Patient/12345 for review', PHI);
    logger.error('Fetched Patient/12345 for review', PHI);

    const out = lines.join('\n');
    expect(lines).toHaveLength(3);
    for (const value of Object.values(PHI)) {
      expect(out).not.toContain(value);
    }
    expect(out).toContain('Patient/[REDACTED]');
  });

  test('allowlisted keys pass through with primitive values', () => {
    logger.info('Request done', { tool: 'search_patient', durationMs: 12, count: 3, httpStatus: 200 });
    expect(lines[0]).toContain('"tool":"search_patient"');
    expect(lines[0]).toContain('"durationMs":12');
    expect(lines[0]).toContain('"count":3');
    expect(lines[0]).toContain('"httpStatus":200');
  });

  test('camelCase and nested keys are redacted (the old denylist bug class)', () => {
    const out = sanitizeData({
      patientName: 'Eleanor Thompson',
      phoneNumber: '555-0101',
      primaryDiagnosis: 'CHF',
      visit: { subjective: 'pain' },
    });
    expect(JSON.stringify(out)).not.toMatch(/Eleanor|555-0101|CHF|pain/);
  });

  test('an allowlisted key cannot smuggle an object or an identifier', () => {
    const out = sanitizeData({ status: { firstName: 'Eleanor' }, tool: 'lookup PT-10001' }) as Record<string, unknown>;
    expect(out.status).toBe('[REDACTED]');
    expect(out.tool).toBe('[REDACTED]');
  });

  test('structured values survive intact: digit-heavy hashes and SQLSTATE codes', () => {
    // Regression: redact()'s digit rule used to corrupt over half of all hashes.
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of ids) {
      const h = hashId(id);
      expect((sanitizeData({ visitIdHash: h }) as Record<string, unknown>).visitIdHash).toBe(h);
    }
    expect((sanitizeData({ status: 'DB_23505' }) as Record<string, unknown>).status).toBe('DB_23505');
  });

  test('each allowlisted key rejects values of the wrong shape', () => {
    const out = sanitizeData({
      visitIdHash: 'Eleanor Thompson',
      status: 'failed for Jane Marple',
      requestId: 'PT-10001',
      resourceType: 'patient/123',
      durationMs: '12',
    }) as Record<string, unknown>;
    expect(Object.values(out).every((v) => v === '[REDACTED]')).toBe(true);
  });

  test('non-object data is not emitted', () => {
    logger.info('x', 'Eleanor Thompson');
    logger.info('x', ['Eleanor']);
    expect(lines.join('\n')).not.toContain('Eleanor');
  });

  test('audit lines carry duration as data and no identifiers', () => {
    logger.audit('get_patient', true, 42);
    expect(lines[0]).toContain('AUDIT: get_patient - SUCCESS');
    expect(lines[0]).toContain('"durationMs":42');
  });

  test('visitIdHash is a stable short hash, not the id', () => {
    const id = '876d62e5-db6e-41ae-a83f-08de169a54bf';
    expect(hashId(id)).toMatch(/^[0-9a-f]{12}$/);
    expect(hashId(id)).toBe(hashId(id));
    logger.info('Synced', { visitIdHash: hashId(id) });
    expect(lines[0]).not.toContain(id);
  });
});

describe('message redaction', () => {
  test.each([
    ['FHIR reference', 'Read Practitioner/abc-123', 'abc-123'],
    ['UUID', 'note 876d62e5-db6e-41ae-a83f-08de169a54bf saved', '876d62e5'],
    ['ISO date', 'born 1940-01-01', '1940-01-01'],
    ['local id', 'patient PT-10001', 'PT-10001'],
    ['phone', 'call 555-0101', '0101'],
    ['email', 'mail a.nurse@example.org', 'a.nurse@example.org'],
    ['long digit run', 'mrn 9876543', '9876543'],
  ])('%s is redacted', (_kind, input, secret) => {
    expect(redact(input)).not.toContain(secret);
  });

  test('ordinary text is unchanged', () => {
    expect(redact('Starting ChartingHero MCP server v0.1.0 (backend=mock)')).toBe(
      'Starting ChartingHero MCP server v0.1.0 (backend=mock)'
    );
  });
});

describe('error surface', () => {
  const outcome = {
    resourceType: 'OperationOutcome',
    issue: [
      { severity: 'error', code: 'processing', diagnostics: 'Patient Jane Marple (DOB 1890-09-15) failed validation' },
      { severity: 'error', code: 'invariant', details: { text: 'Marple already has an open Encounter' } },
    ],
  };

  test('formatErrorForMcp drops OperationOutcome diagnostics and details', () => {
    const text = formatErrorForMcp(ApiError.fromOperationOutcome(422, outcome)).text;
    expect(text).not.toContain('Marple');
    expect(text).not.toContain('1890');
    expect(text).toContain('HTTP 422');
    expect(text).toContain('processing, invariant');
  });

  test('a raw OperationOutcome passed directly is reduced the same way', () => {
    const text = formatErrorForMcp(outcome).text;
    expect(text).not.toContain('Marple');
    expect(text).toContain('API_ERROR');
  });

  test('ApiError keeps only codes from the FHIR IssueType value set', () => {
    const err = new ApiError(400, ['not-found', 'Jane Marple', 'marple', 'jane-synthetic-doe', 'x'.repeat(80)]);
    expect(err.issueCodes).toEqual(['not-found']);
    expect(err.message.toLowerCase()).not.toContain('marple');
    expect(err.message).not.toContain('jane');
  });

  test('an unexpected Error shows its class name, never its message', () => {
    const text = formatErrorForMcp(new TypeError('cannot read Jane Marple')).text;
    expect(text).toBe('Error [INTERNAL]: unexpected TypeError');
  });

  test('our own error messages are still shown', () => {
    expect(formatErrorForMcp(new ValidationError('Patient ID is required', 'patientId')).text).toBe(
      'Error [VALIDATION_ERROR]: Patient ID is required'
    );
  });

  test('errorLogFields carries codes, never messages', () => {
    expect(errorLogFields(new ApiError(503))).toEqual({ status: 'API_ERROR', httpStatus: 503 });
    expect(JSON.stringify(errorLogFields(new Error('Jane Marple')))).not.toContain('Marple');
  });
});
