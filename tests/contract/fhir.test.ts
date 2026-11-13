/**
 * The backend contract against a FHIR server: recorded Bundles by default, a live server
 * when FHIR_IT_BASE_URL is set (see recorded-fetch.ts). The data is the fictional set from
 * scripts/seed-fhir.mjs.
 */

import { afterAll, afterEach, describe, test, expect } from '@jest/globals';

import { FhirBackend } from '../../src/backends/fhir/fhir-backend.js';
import type { FhirConfig } from '../../src/config.js';
import { NotImplementedError } from '../../src/utils/errors.js';
import { backendContract } from './backend.contract.js';
import { fhirTransport } from './recorded-fetch.js';

const transport = fhirTransport();
const SYS = process.env.FHIR_IDENTIFIER_SYSTEM ?? 'https://memyselfplusai.com/fhir/chartinghero';

const config: FhirConfig = {
  baseUrl: transport.base,
  host: new URL(transport.base).host,
  environment: 'local',
  write: true,
  writeProfile: 'full',
  practitionerId: 'unused-in-reads',
  identifierSystem: SYS,
};
const make = () => new FhirBackend({ config, timeoutMs: 20_000, fetch: transport.fetch });
const CTX = { requestId: 'contract', timezone: 'America/New_York' };

afterAll(() => transport.save());
// A missing recording reaches a test as "transient"; name the request instead.
afterEach(() => {
  const missed = transport.misses.splice(0);
  if (missed.length > 0) throw new Error(`no recording for:\n${missed.join('\n')}\nrecord again (see CLAUDE.md)`);
});

backendContract(`fhir (${transport.mode})`, make, {
  known: { identifier: 'PT-10001', firstName: 'Jane', lastName: 'Marple', dateOfBirth: '1942-03-15', phone: '555-0101' },
  visits: [
    { date: '2026-10-20', type: 'skilled_nursing' },
    { date: '2026-10-17', type: 'physical_therapy' },
  ],
  typeFilter: { type: 'physical_therapy', dates: ['2026-10-17'] },
  // HAPI matches a name by prefix: Jane Marple and James Thompson.
  sharedNameQuery: 'Ja',
  notActive: { query: 'Anderson', status: 'inactive', identifier: 'PT-10005' },
  unknownIdentifier: 'PT-00000',
});

describe(`fhir server behaviour (${transport.mode})`, () => {
  test('the server is R4 4.0.1 and init accepts it', async () => {
    const res = await transport.fetch(`${transport.base}/metadata`, { method: 'GET' });
    expect(((await res.json()) as { fhirVersion: string }).fhirVersion).toBe('4.0.1');
    await expect(make().init()).resolves.toBeUndefined();
  });

  test('visit status comes from the note: unsigned is pending_review, signed is completed', async () => {
    const r = await make().getPatientHistory({ patientId: 'PT-10001' }, CTX);
    expect(r.visits.map((v) => v.status)).toEqual(['pending_review', 'completed']);
    expect(r.visits.map((v) => v.nurseName)).toEqual(['Avery Quinn, RN', 'Avery Quinn, RN']);
    expect(r.visits.map((v) => v.duration)).toEqual([45, 30]);
  });

  test('vitals with no encounter link still count, and a clinic visit is not listed', async () => {
    const r = await make().getPatientHistory({ patientId: 'PT-10002' }, CTX);
    expect(r.visits.map((v) => [v.visitDate, v.visitType, v.hasVitals])).toEqual([['2026-10-19', 'skilled_nursing', true]]);
    expect(r.total).toBe(1);
  });

  test('a history cursor cannot be replayed for another patient', async () => {
    const backend = make();
    const first = await backend.getPatientHistory({ patientId: 'PT-10001', limit: 1 }, CTX);
    await expect(backend.getPatientHistory({ patientId: 'PT-10002', cursor: first.nextCursor }, CTX)).rejects.toThrow(
      'cursor belongs to a different patient'
    );
  });

  test('createVisitNote passes the real pre-flight and stops at NotImplemented', async () => {
    await expect(
      make().createVisitNote(
        { patientId: 'PT-10001', visitType: 'skilled_nursing', visitDate: '2026-10-21', timeIn: '09:00', timeOut: '09:30' },
        {
          ...CTX,
          practitioner: { reference: 'Practitioner/unused', display: 'Avery Quinn, RN', source: 'configured-sandbox' },
          idempotencyKey: 'contract-visit-never-written',
          dryRun: false,
        }
      )
    ).rejects.toThrow(NotImplementedError);
  });
});
