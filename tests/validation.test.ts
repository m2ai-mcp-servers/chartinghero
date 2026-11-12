/**
 * Input validation at the tool boundary (PR4). All values are synthetic.
 *
 * The server-level tests drive the real McpServer over an in-memory transport with a
 * spied backend, so "rejected" means the SDK refused the call before any backend method ran.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';
import { resetConfig } from '../src/config.js';
import { configurePatientService, resetPatientService } from '../src/services/patient-service.js';
import { MockBackend } from '../src/backends/mock-backend.js';
import type { WriteContext } from '../src/backends/types.js';
import { createVisitNoteSchema } from '../src/schemas/visit-note.js';
import { patientHistorySchema, searchPatientSchema } from '../src/schemas/read-tools.js';
import { isRealDate } from '../src/schemas/common.js';

const BASE = {
  patientId: 'PT-10001',
  visitType: 'skilled_nursing',
  visitDate: '2026-11-10',
  timeIn: '09:00',
  timeOut: '09:45',
};

const withVitals = (v: Record<string, unknown>) => ({ ...BASE, vitalSigns: v });

/** The plan's rejection list plus the gaps around each rule. */
const REJECTED: Array<[string, string, Record<string, unknown>]> = [
  ['oxygenSaturation 101', 'create_visit_note', withVitals({ oxygenSaturation: 101 })],
  ['heartRate -1', 'create_visit_note', withVitals({ heartRate: -1 })],
  ["timeIn '10am'", 'create_visit_note', { ...BASE, timeIn: '10am' }],
  ["visitType 'bogus'", 'create_visit_note', { ...BASE, visitType: 'bogus' }],
  ['lone systolic', 'create_visit_note', withVitals({ bloodPressureSystolic: 120 })],
  ['lone diastolic', 'create_visit_note', withVitals({ bloodPressureDiastolic: 80 })],
  ['limit -3 (search)', 'search_patient', { query: 'Thompson', limit: -3 }],
  ['limit -3 (history)', 'get_patient_history', { patientId: 'PT-10001', limit: -3 }],
  ['nextVisitDate before visitDate', 'create_visit_note', { ...BASE, nextVisitDate: '2026-11-09' }],
  ['nextVisitDate equal to visitDate', 'create_visit_note', { ...BASE, nextVisitDate: '2026-11-10' }],
  ['impossible date', 'create_visit_note', { ...BASE, visitDate: '2026-02-30' }],
  ['timeOut before timeIn, not overnight', 'create_visit_note', { ...BASE, timeIn: '23:30', timeOut: '00:15' }],
  ['timeOut equal to timeIn', 'create_visit_note', { ...BASE, timeOut: '09:00' }],
  ['overnight but timeOut after timeIn', 'create_visit_note', { ...BASE, overnight: true }],
  ['24:00 is not a time', 'create_visit_note', { ...BASE, timeOut: '24:00' }],
  ['temperature without unit', 'create_visit_note', withVitals({ temperature: 98.6 })],
  ['weight without unit', 'create_visit_note', withVitals({ weight: 150 })],
  ['98.6 in Celsius', 'create_visit_note', withVitals({ temperature: 98.6, temperatureUnit: 'C' })],
  ['0.5 lbs (valid in kg, not in lbs)', 'create_visit_note', withVitals({ weight: 0.5, weightUnit: 'lbs' })],
  ['pain 7.5', 'create_visit_note', withVitals({ painLevel: 7.5 })],
  ['pain 11', 'create_visit_note', withVitals({ painLevel: 11 })],
  ['O2 flow 20', 'create_visit_note', withVitals({ oxygenFlowRate: 20 })],
  ['glucose 5000', 'create_visit_note', withVitals({ bloodGlucose: 5000 })],
  ['vital typo is not silently dropped', 'create_visit_note', withVitals({ heartrate: 80 })],
  ['unknown top-level field', 'create_visit_note', { ...BASE, vitals: { heartRate: 80 } }],
  ['string where a number belongs', 'create_visit_note', withVitals({ heartRate: '80' })],
  ['clientVisitId not a UUID', 'create_visit_note', { ...BASE, clientVisitId: 'visit-1' }],
  ['timezone not IANA', 'create_visit_note', { ...BASE, timezone: 'Eastern' }],
  ['blank patientId', 'create_visit_note', { ...BASE, patientId: '   ' }],
  ['limit 51', 'search_patient', { query: 'Thompson', limit: 51 }],
  ['limit 2.5', 'search_patient', { query: 'Thompson', limit: 2.5 }],
  ['blank query', 'search_patient', { query: '' }],
  ['history visitType bogus', 'get_patient_history', { patientId: 'PT-10001', visitType: 'bogus' }],
  ['history bad startDate', 'get_patient_history', { patientId: 'PT-10001', startDate: '11/10/2026' }],
];

/** Abnormal but real readings must chart: these are critical values, not errors. */
const ACCEPTED: Array<[string, Record<string, unknown>]> = [
  ['BASE', BASE],
  ['BP 190/110', withVitals({ bloodPressureSystolic: 190, bloodPressureDiastolic: 110 })],
  ['SpO2 88', withVitals({ oxygenSaturation: 88 })],
  ['SpO2 92 on 2 L/min', withVitals({ oxygenSaturation: 92, oxygenFlowRate: 2 })],
  ['room air is flow 0', withVitals({ oxygenSaturation: 97, oxygenFlowRate: 0 })],
  ['pain 0', withVitals({ painLevel: 0 })],
  ['temp 39.5 C', withVitals({ temperature: 39.5, temperatureUnit: 'C' })],
  ['weight 82 kg', withVitals({ weight: 82, weightUnit: 'kg' })],
  ['glucose 45', withVitals({ bloodGlucose: 45 })],
  ['overnight 23:30 to 00:15', { ...BASE, timeIn: '23:30', timeOut: '00:15', overnight: true }],
  ['leap day', { ...BASE, visitDate: '2028-02-29' }],
  ['all optional fields', {
    ...BASE,
    nextVisitDate: '2026-11-12',
    clientVisitId: '9b2f4c1e-3d5a-4e6f-8a7b-0c1d2e3f4a5b',
    timezone: 'America/New_York',
    dryRun: false,
    interventions: ['wound care'],
    education: ['fall prevention'],
  }],
];

describe('schemas (pure)', () => {
  test.each(REJECTED)('rejects %s', (_name, tool, args) => {
    const schema = tool === 'create_visit_note' ? createVisitNoteSchema
      : tool === 'search_patient' ? searchPatientSchema : patientHistorySchema;
    expect(schema.safeParse(args).success).toBe(false);
  });

  test.each(ACCEPTED)('accepts %s', (_name, args) => {
    const r = createVisitNoteSchema.safeParse(args);
    expect(r.error?.issues).toBeUndefined();
    expect(r.success).toBe(true);
  });

  test.each([
    ['2026-11-10', true], ['2028-02-29', true], ['2026-02-29', false], ['2026-13-01', false],
    ['2026-04-31', false], ['2026-1-1', false], ['20261110', false],
  ])('isRealDate(%s) is %s', (value, expected) => {
    expect(isRealDate(value)).toBe(expected);
  });

  test('bounds are inclusive at both ends', () => {
    for (const [v, ok] of [[50, true], [49.9, false], [300, true], [300.1, false]] as const) {
      const r = createVisitNoteSchema.safeParse(withVitals({ bloodPressureSystolic: v, bloodPressureDiastolic: 80 }));
      expect(r.success).toBe(ok);
    }
  });
});

describe('server boundary', () => {
  const backend = new MockBackend();
  const calls = {
    searchPatients: jest.spyOn(backend, 'searchPatients'),
    getPatient: jest.spyOn(backend, 'getPatient'),
    getPatientHistory: jest.spyOn(backend, 'getPatientHistory'),
    createVisitNote: jest.spyOn(backend, 'createVisitNote'),
  };
  const totalCalls = () => Object.values(calls).reduce((n, s) => n + s.mock.calls.length, 0);
  let client: Client;

  beforeAll(async () => {
    process.env.BACKEND = 'mock';
    resetConfig();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer('0.0.0-test').connect(serverSide);
    client = new Client({ name: 'validation-test', version: '0.0.0' });
    await client.connect(clientSide);
  });

  afterAll(async () => {
    await client.close();
    delete process.env.BACKEND;
    resetConfig();
    resetPatientService();
  });

  beforeEach(() => {
    resetPatientService();
    backend.reset();
    configurePatientService({ backend, sync: async () => true });
    for (const spy of Object.values(calls)) spy.mockClear();
  });

  const text = (res: Awaited<ReturnType<Client['callTool']>>) =>
    (res.content as Array<{ text: string }>).map((c) => c.text).join('\n');

  test.each(REJECTED)('%s: isError and zero backend calls', async (_name, tool, args) => {
    const res = await client.callTool({ name: tool, arguments: args });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Input validation error');
    expect(totalCalls()).toBe(0);
  });

  test('a rejection names the rule and the field, not the submitted text', async () => {
    const res = await client.callTool({
      name: 'create_visit_note',
      arguments: { ...BASE, timeIn: 'Jane Marple 10am', clientVisitId: 'Marple-visit', MarpleNotes: 'x',
        vitalSigns: { Marple: 1 } },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('timeIn');
    expect(text(res)).not.toContain('Marple');
  });

  test.each(ACCEPTED)('%s: reaches the backend once', async (_name, args) => {
    const res = await client.callTool({ name: 'create_visit_note', arguments: args });
    expect(text(res)).not.toContain('Input validation error');
    expect(res.isError).toBeFalsy();
    expect(calls.createVisitNote).toHaveBeenCalledTimes(1);
  });

  test('a recorded 0 is displayed', async () => {
    const res = await client.callTool({
      name: 'create_visit_note',
      arguments: withVitals({ painLevel: 0, oxygenSaturation: 96, oxygenFlowRate: 0 }),
    });
    expect(text(res)).toContain('Pain: 0/10');
    expect(text(res)).toContain('O2 Sat: 96% on room air');
  });

  test('overnight duration spans midnight', async () => {
    const res = await client.callTool({
      name: 'create_visit_note',
      arguments: { ...BASE, timeIn: '23:30', timeOut: '00:15', overnight: true },
    });
    expect(text(res)).toContain('Duration: 45 minutes');
  });

  test('dryRun reaches the backend with dryRun set and stores nothing', async () => {
    const res = await client.callTool({ name: 'create_visit_note', arguments: { ...BASE, dryRun: true } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('Dry Run');
    const ctx = calls.createVisitNote.mock.calls[0][1] as WriteContext;
    expect(ctx.dryRun).toBe(true);
    const history = await client.callTool({
      name: 'get_patient_history',
      arguments: { patientId: 'PT-10001', startDate: '2026-11-10', endDate: '2026-11-10' },
    });
    expect(text(history)).toContain('No visits found');
  });

  test('clientVisitId becomes the idempotency key; timezone overrides the default', async () => {
    const id = '9b2f4c1e-3d5a-4e6f-8a7b-0c1d2e3f4a5b';
    await client.callTool({
      name: 'create_visit_note',
      arguments: { ...BASE, clientVisitId: id, timezone: 'America/Chicago' },
    });
    const ctx = calls.createVisitNote.mock.calls[0][1] as WriteContext;
    expect(ctx.idempotencyKey).toBe(id);
    expect(ctx.timezone).toBe('America/Chicago');
  });

  test('tools/list publishes zod-derived schemas and the planned annotations', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(['create_visit_note', 'get_patient_history', 'search_patient']);

    expect(byName.search_patient.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(byName.get_patient_history.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(byName.create_visit_note.annotations).toEqual({
      readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true,
    });

    const schema = byName.create_visit_note.inputSchema as {
      required: string[];
      properties: Record<string, { enum?: string[]; properties?: Record<string, { maximum?: number }> }>;
    };
    expect(schema.required.sort()).toEqual(['patientId', 'timeIn', 'timeOut', 'visitDate', 'visitType']);
    expect(schema.properties.visitType.enum).toHaveLength(10);
    expect(schema.properties.vitalSigns.properties?.oxygenSaturation.maximum).toBe(100);
  });
});
