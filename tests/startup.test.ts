/**
 * Process-level startup tests: the server must exit non-zero with a clear stderr
 * message on bad config, and serve 3 tools over stdio on good config.
 * Runs the TypeScript entry point through tsx, so no build is needed.
 */

import { describe, test, expect } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(process.cwd());
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const ENTRY = path.join(ROOT, 'src', 'index.ts');

const V = {
  FHIR_BASE_URL: 'http://127.0.0.1:8080/fhir',
  FHIR_ENVIRONMENT: 'local',
  FHIR_PRACTITIONER_ID: 'p1',
  VISIT_TIMEZONE: 'America/New_York',
  FHIR_IDENTIFIER_SYSTEM: 'urn:test',
};

/** Minimal env: PATH and HOME only, so the host environment cannot leak in. */
function baseEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
}

function start(env: Record<string, string>) {
  const r = spawnSync(TSX, [ENTRY], { env: { ...baseEnv(), ...env }, input: '', encoding: 'utf8', timeout: 20000 });
  return { status: r.status, stderr: r.stderr };
}

describe('startup gate matrix', () => {
  test.each<[string, Record<string, string>, string]>([
    ['unknown BACKEND', { ...V, BACKEND: 'bogus' }, 'BACKEND must be mock or fhir'],
    ['FHIR_* without BACKEND', V, 'BACKEND is required when FHIR_* vars are set'],
    ['production environment', { ...V, BACKEND: 'fhir', FHIR_ENVIRONMENT: 'production' }, 'FHIR_ENVIRONMENT=production is not supported'],
    [
      'write to a host outside WRITE_HOSTS',
      { ...V, BACKEND: 'fhir', FHIR_ENVIRONMENT: 'sandbox', FHIR_WRITE: 'on', FHIR_BASE_URL: 'https://unknown.example/fhir' },
      'not in WRITE_HOSTS',
    ],
    ['invalid LOG_LEVEL', { BACKEND: 'mock', LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    ['valid fhir config before PR6', { ...V, BACKEND: 'fhir' }, 'fhir backend not implemented in this build'],
  ])('%s: exits non-zero with a clear message', (_name, env, text) => {
    const { status, stderr } = start(env);
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
    expect(stderr).toContain(text);
  }, 30000);
});

describe('positive control', () => {
  test('BACKEND=mock starts and lists 3 tools over stdio', async () => {
    const transport = new StdioClientTransport({
      command: TSX,
      args: [ENTRY],
      env: { ...baseEnv(), BACKEND: 'mock' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'startup-test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['create_visit_note', 'get_patient_history', 'search_patient']);

      // Object.prototype names must hit the unknown-tool path, not echo the arguments.
      for (const name of ['constructor', 'toString', '__proto__']) {
        const res = await client.callTool({ name, arguments: { patientId: 'PT-SYNTH-1' } });
        expect(res.isError).toBe(true);
        expect(JSON.stringify(res)).not.toContain('PT-SYNTH-1');
        expect(JSON.stringify(res.content)).toContain('Unknown tool');
      }
    } finally {
      await client.close();
    }
  }, 30000);
});
