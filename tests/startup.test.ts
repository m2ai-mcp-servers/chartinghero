/**
 * Process-level startup tests: the server must exit non-zero with a clear stderr
 * message on bad config, and serve 3 tools over stdio on good config.
 * Runs the TypeScript entry point through tsx, so no build is needed.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    // Port 9 (discard) is closed on a normal host: the /metadata probe cannot connect.
    ['unreachable FHIR server', { ...V, BACKEND: 'fhir', FHIR_BASE_URL: 'http://127.0.0.1:9/fhir' }, 'cannot read FHIR /metadata'],
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

      // Object.prototype names must never execute or echo the arguments. Tool lookup is the
      // SDK's since PR4: it reports these as "Tool <name> disabled" (its registry is a plain
      // object), and a real unknown name as "not found". Either way, nothing runs.
      for (const name of ['constructor', 'toString', '__proto__', 'no_such_tool']) {
        const res = await client.callTool({ name, arguments: { patientId: 'PT-SYNTH-1' } });
        expect(res.isError).toBe(true);
        expect(JSON.stringify(res)).not.toContain('PT-SYNTH-1');
        expect(JSON.stringify(res.content)).toMatch(/Tool .* (not found|disabled)/);
      }
    } finally {
      await client.close();
    }
  }, 30000);
});

describe('BACKEND=fhir startup probe', () => {
  // A stub FHIR server that only answers /metadata. spawnSync would block this process and
  // starve the stub, so these cases spawn asynchronously.
  let version = '4.0.1';
  const hits: string[] = [];
  const stub = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url !== '/fhir/metadata') {
      res.writeHead(404, { 'content-type': 'application/fhir+json' });
      res.end(JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-found' }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/fhir+json' });
    res.end(JSON.stringify({ resourceType: 'CapabilityStatement', status: 'active', kind: 'instance', fhirVersion: version, rest: [] }));
  });
  let env: Record<string, string>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as AddressInfo;
    env = { ...baseEnv(), ...V, BACKEND: 'fhir', FHIR_BASE_URL: `http://127.0.0.1:${port}/fhir` };
  });
  afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  test('a server that is not R4 aborts startup', async () => {
    version = '5.0.0';
    const child = spawn(TSX, [ENTRY], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stdin.end();
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(status).toBe(1);
    expect(stderr).toContain('startup aborted: FHIR server is not R4');
    expect(stderr).not.toContain('5.0.0');
  }, 30000);

  test('an R4 server passes the probe and the server lists 3 tools', async () => {
    version = '4.0.1';
    hits.length = 0;
    const transport = new StdioClientTransport({ command: TSX, args: [ENTRY], env, stderr: 'pipe' });
    const client = new Client({ name: 'startup-test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(3);
      expect(hits).toEqual(['GET /fhir/metadata']);
    } finally {
      await client.close();
    }
  }, 30000);
});
