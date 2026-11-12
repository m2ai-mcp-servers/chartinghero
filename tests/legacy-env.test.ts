/**
 * Legacy env shim: the pre-pivot vendor variables warn but no longer select a backend.
 */

import { describe, test, expect } from '@jest/globals';
import { loadConfig } from '../src/config.js';
import { readLegacyEnv } from '../src/legacy-env.js';

describe('legacy env shim', () => {
  test('POINTCARE_API_URL no longer flips the mode', () => {
    const config = loadConfig({ POINTCARE_API_URL: 'https://x.example' });
    expect(config.backend).toBe('mock');
    expect(config.backendDefaulted).toBe(true);
    expect(config.fhir).toBeUndefined();
  });

  test('each vendor var present yields a deprecation warning', () => {
    const { warnings } = readLegacyEnv({
      POINTCARE_API_URL: 'x', POINTCARE_API_KEY: 'x', POINTCARE_CLIENT_ID: 'x', POINTCARE_CLIENT_SECRET: 'x',
    });
    expect(warnings).toHaveLength(4);
    warnings.forEach((w) => expect(w).toMatch(/deprecated and ignored/));
  });

  test('RATCHET_MOCK_MODE=true maps to an explicit mock backend, with a warning', () => {
    const config = loadConfig({ RATCHET_MOCK_MODE: 'true' });
    expect(config.backend).toBe('mock');
    expect(config.backendDefaulted).toBe(false);
    expect(config.warnings.some((w) => w.includes('RATCHET_MOCK_MODE is deprecated'))).toBe(true);
  });

  test('legacy vars do not satisfy the BACKEND requirement when FHIR_* is set', () => {
    expect(() => loadConfig({ RATCHET_MOCK_MODE: 'true', FHIR_BASE_URL: 'http://127.0.0.1/fhir' }))
      .toThrow('BACKEND is required when FHIR_* vars are set');
  });

  test('no legacy vars, no warnings', () => {
    expect(readLegacyEnv({}).warnings).toEqual([]);
  });
});
