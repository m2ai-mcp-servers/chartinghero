/**
 * Config gate tests: every negative case supplies all other required vars,
 * so only the gate under test can fail.
 */

import { describe, test, expect } from '@jest/globals';
import { ConfigError, DEFAULT_IDENTIFIER_SYSTEM, loadConfig } from '../src/config.js';
import { isWriteHost, WRITE_HOSTS } from '../src/config/hosts.js';

const V = {
  FHIR_BASE_URL: 'http://127.0.0.1:8080/fhir',
  FHIR_ENVIRONMENT: 'local',
  FHIR_PRACTITIONER_ID: 'p1',
  VISIT_TIMEZONE: 'America/New_York',
  FHIR_IDENTIFIER_SYSTEM: 'urn:test',
};

function problemsFor(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

function expectRejected(env: Record<string, string>, text: string): void {
  const problems = problemsFor(env);
  expect(problems.some((p) => p.includes(text))).toBe(true);
}

describe('BACKEND', () => {
  test('unset with no FHIR_* vars falls back to mock and flags it', () => {
    const config = loadConfig({});
    expect(config.backend).toBe('mock');
    expect(config.backendDefaulted).toBe(true);
    expect(config.dashboardSync).toBe(false);
  });

  test('explicit mock is not flagged as a fallback', () => {
    expect(loadConfig({ BACKEND: 'mock' }).backendDefaulted).toBe(false);
  });

  test('rejects an unknown value', () => {
    expectRejected({ ...V, BACKEND: 'bogus' }, 'BACKEND must be mock or fhir');
  });

  test('is required when FHIR_* vars are set', () => {
    expectRejected(V, 'BACKEND is required when FHIR_* vars are set');
  });

  test('a valid fhir config parses', () => {
    const config = loadConfig({ ...V, BACKEND: 'fhir' });
    expect(config.backend).toBe('fhir');
    expect(config.fhir).toMatchObject({
      host: '127.0.0.1',
      environment: 'local',
      write: false,
      writeProfile: 'full',
      practitionerId: 'p1',
      identifierSystem: 'urn:test',
    });
  });

  test('identifier system defaults to the project namespace', () => {
    const { FHIR_IDENTIFIER_SYSTEM: _omit, ...rest } = V;
    expect(loadConfig({ ...rest, BACKEND: 'fhir' }).fhir?.identifierSystem).toBe(DEFAULT_IDENTIFIER_SYSTEM);
  });
});

describe('fhir gates', () => {
  const fhir = { ...V, BACKEND: 'fhir' };

  test('FHIR_ENVIRONMENT=production aborts', () => {
    expectRejected({ ...fhir, FHIR_ENVIRONMENT: 'production' }, 'FHIR_ENVIRONMENT=production is not supported');
  });

  test('FHIR_ENVIRONMENT must be local or sandbox', () => {
    expectRejected({ ...fhir, FHIR_ENVIRONMENT: 'staging' }, 'FHIR_ENVIRONMENT must be local or sandbox');
  });

  test('FHIR_WRITE=on to an unknown host is refused', () => {
    expectRejected(
      { ...fhir, FHIR_ENVIRONMENT: 'sandbox', FHIR_WRITE: 'on', FHIR_BASE_URL: 'https://unknown.example/fhir' },
      'FHIR_WRITE=on refused: host unknown.example is not in WRITE_HOSTS'
    );
  });

  test('FHIR_WRITE=on to a WRITE_HOSTS host is accepted', () => {
    const config = loadConfig({ ...fhir, FHIR_WRITE: 'on', FHIR_BASE_URL: 'https://hapi.fhir.org/baseR4' });
    expect(config.fhir?.write).toBe(true);
  });

  test('a configured Practitioner is refused on a host outside WRITE_HOSTS', () => {
    expectRejected(
      { ...fhir, FHIR_ENVIRONMENT: 'sandbox', FHIR_BASE_URL: 'https://unknown.example/fhir' },
      'FHIR_PRACTITIONER_ID refused'
    );
  });

  test.each([
    ['FHIR_BASE_URL', 'FHIR_BASE_URL is required'],
    ['FHIR_PRACTITIONER_ID', 'FHIR_PRACTITIONER_ID is required'],
    ['VISIT_TIMEZONE', 'VISIT_TIMEZONE is required'],
    ['FHIR_ENVIRONMENT', 'FHIR_ENVIRONMENT is required'],
  ])('missing %s aborts', (key, text) => {
    const env: Record<string, string> = { ...fhir };
    delete env[key];
    expectRejected(env, text);
  });

  test('an unparseable FHIR_BASE_URL aborts', () => {
    expectRejected({ ...fhir, FHIR_BASE_URL: 'not a url' }, 'FHIR_BASE_URL is not a valid URL');
  });

  test('an invalid VISIT_TIMEZONE aborts', () => {
    expectRejected({ ...fhir, VISIT_TIMEZONE: 'Mars/Olympus_Mons' }, 'VISIT_TIMEZONE is not a valid IANA time zone');
  });

  test('a malformed Practitioner id aborts', () => {
    expectRejected({ ...fhir, FHIR_PRACTITIONER_ID: 'p 1/../x' }, 'FHIR_PRACTITIONER_ID is not a valid FHIR resource id');
  });

  test('FHIR_WRITE_PROFILE is an enum', () => {
    expectRejected({ ...fhir, FHIR_WRITE_PROFILE: 'partial' }, 'FHIR_WRITE_PROFILE must be full or note-only');
  });
});

describe('other gates', () => {
  test('an invalid LOG_LEVEL aborts instead of silently suppressing logs', () => {
    expectRejected({ BACKEND: 'mock', LOG_LEVEL: 'verbose' }, 'LOG_LEVEL');
  });

  test('DASHBOARD_SYNC is on or off', () => {
    expect(loadConfig({ DASHBOARD_SYNC: 'on' }).dashboardSync).toBe(true);
    expectRejected({ DASHBOARD_SYNC: 'yes' }, 'DASHBOARD_SYNC must be on or off');
  });

  test('every problem is reported at once', () => {
    const problems = problemsFor({ BACKEND: 'bogus', LOG_LEVEL: 'verbose', DASHBOARD_SYNC: 'yes' });
    expect(problems).toHaveLength(3);
  });
});

describe('WRITE_HOSTS', () => {
  test('matches the plan list exactly', () => {
    expect([...WRITE_HOSTS].sort()).toEqual(
      ['127.0.0.1', 'localhost', '::1', '10.0.0.46', 'hapi.fhir.org', 'server.fire.ly'].sort()
    );
  });

  test('IPv6 loopback in URL form is recognised', () => {
    expect(isWriteHost(new URL('http://[::1]:8080/fhir').hostname)).toBe(true);
  });

  test('look-alike hosts are not', () => {
    expect(isWriteHost('hapi.fhir.org.evil.example')).toBe(false);
    expect(isWriteHost('127.0.0.2')).toBe(false);
  });
});
