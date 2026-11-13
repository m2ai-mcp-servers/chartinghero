/**
 * Backend contract: what search_patient and get_patient_history promise, whichever backend
 * answers. It asserts intent (the exact identifier hit, the name match, newest first,
 * hasVitals), not how one backend happens to match text. Each backend supplies its own
 * synthetic world.
 */

import { describe, test, expect, beforeAll } from '@jest/globals';

import type { PatientBackend } from '../../src/backends/types.js';
import type { PatientSearchParams, PatientSearchResult, VisitType } from '../../src/types/index.js';
import { NotFoundError, ValidationError } from '../../src/utils/errors.js';

export interface ContractWorld {
  /** A patient with at least two home health visits, every one with vitals. */
  known: { identifier: string; firstName: string; lastName: string; dateOfBirth: string; phone: string };
  /** That patient's visits, newest first. */
  visits: Array<{ date: string; type: VisitType }>;
  /** A visit type filter and the visit dates it must leave, newest first. */
  typeFilter: { type: VisitType; dates: string[] };
  /** A name query matching at least two patients, for paging. */
  sharedNameQuery: string;
  /** A patient who is not active: the name query and status that find them. */
  notActive: { query: string; status: NonNullable<PatientSearchParams['status']>; identifier: string };
  unknownIdentifier: string;
}

const CTX = { requestId: 'contract', timezone: 'America/New_York' };

/** The human identifier of a result: the mock uses it as the id, FHIR carries it beside the server id. */
const identifierOf = (r: PatientSearchResult) => r.identifier ?? r.id;

export function backendContract(name: string, make: () => PatientBackend | Promise<PatientBackend>, world: ContractWorld): void {
  const { known } = world;

  describe(`backend contract: ${name}`, () => {
    let backend: PatientBackend;
    beforeAll(async () => {
      backend = await make();
      await backend.init?.();
    });

    describe('searchPatients', () => {
      test('an identifier search returns exactly that patient', async () => {
        const r = await backend.searchPatients({ query: known.identifier, searchType: 'id' }, CTX);
        expect(r.results).toHaveLength(1);
        expect(identifierOf(r.results[0])).toBe(known.identifier);
        expect(r.results[0]).toMatchObject({
          firstName: known.firstName,
          lastName: known.lastName,
          dateOfBirth: known.dateOfBirth,
          phone: known.phone,
          status: 'active',
        });
        expect(r.hasMore).toBe(false);
      });

      test('the default search also finds a patient by identifier', async () => {
        const r = await backend.searchPatients({ query: known.identifier }, CTX);
        expect(r.results.map(identifierOf)).toEqual([known.identifier]);
      });

      test.each([
        ['First Last', (k: ContractWorld['known']) => `${k.firstName} ${k.lastName}`],
        ['Last, First', (k: ContractWorld['known']) => `${k.lastName}, ${k.firstName}`],
        ['lower case', (k: ContractWorld['known']) => `${k.firstName} ${k.lastName}`.toLowerCase()],
      ])('a full-name search (%s) returns exactly that patient', async (_label, query) => {
        const r = await backend.searchPatients({ query: query(known), searchType: 'name' }, CTX);
        expect(r.results.map(identifierOf)).toEqual([known.identifier]);
      });

      test('name plus date of birth narrows to the patient; a wrong date of birth finds nobody', async () => {
        const right = await backend.searchPatients({ query: `${known.lastName} ${known.dateOfBirth}`, searchType: 'name' }, CTX);
        expect(right.results.map(identifierOf)).toEqual([known.identifier]);
        const wrong = await backend.searchPatients({ query: `${known.lastName} 1901-01-01`, searchType: 'name' }, CTX);
        expect(wrong.results).toEqual([]);
      });

      test('a phone search finds the patient', async () => {
        const r = await backend.searchPatients({ query: known.phone, searchType: 'phone' }, CTX);
        expect(r.results.map(identifierOf)).toContain(known.identifier);
      });

      test('no match is an empty page, not an error', async () => {
        const r = await backend.searchPatients({ query: 'Zzyzxqq', searchType: 'name' }, CTX);
        expect(r).toMatchObject({ results: [], total: 0, hasMore: false });
        expect(r.nextCursor).toBeUndefined();
        const byId = await backend.searchPatients({ query: world.unknownIdentifier, searchType: 'id' }, CTX);
        expect(byId.results).toEqual([]);
      });

      test('the status filter keeps only that status', async () => {
        const { query, status, identifier } = world.notActive;
        const hit = await backend.searchPatients({ query, searchType: 'name', status }, CTX);
        expect(hit.results.map(identifierOf)).toEqual([identifier]);
        expect(hit.results[0].status).toBe(status);
        const miss = await backend.searchPatients({ query, searchType: 'name', status: 'active' }, CTX);
        expect(miss.results).toEqual([]);
      });

      test('limit caps the page and the cursor continues without repeating a patient', async () => {
        const first = await backend.searchPatients({ query: world.sharedNameQuery, searchType: 'name', limit: 1 }, CTX);
        expect(first.results).toHaveLength(1);
        expect(first.limit).toBe(1);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).toEqual(expect.any(String));

        const second = await backend.searchPatients(
          { query: world.sharedNameQuery, searchType: 'name', limit: 1, cursor: first.nextCursor },
          CTX
        );
        expect(second.results).toHaveLength(1);
        expect(second.results[0].id).not.toBe(first.results[0].id);
      });

      test('a cursor this server did not issue is rejected', async () => {
        await expect(backend.searchPatients({ query: 'x', cursor: 'bm90LWEtY3Vyc29y.c2ln' }, CTX)).rejects.toThrow(ValidationError);
      });
    });

    describe('getPatient', () => {
      test('resolves by identifier and by the id a search returned, to the same patient', async () => {
        const byIdentifier = await backend.getPatient({ identifier: known.identifier }, CTX);
        expect(byIdentifier.demographics).toMatchObject({
          firstName: known.firstName,
          lastName: known.lastName,
          dateOfBirth: known.dateOfBirth,
        });
        const found = await backend.searchPatients({ query: known.identifier, searchType: 'id' }, CTX);
        const byId = await backend.getPatient({ serverId: found.results[0].id }, CTX);
        expect(byId.id).toEqual(byIdentifier.id);
      });

      test('an unknown patient is NotFound', async () => {
        await expect(backend.getPatient({ identifier: world.unknownIdentifier }, CTX)).rejects.toThrow(NotFoundError);
        await expect(backend.getPatient({ serverId: 'no-such-id' }, CTX)).rejects.toThrow(NotFoundError);
      });
    });

    describe('getPatientHistory', () => {
      test('lists the visits newest first, each with vitals', async () => {
        const r = await backend.getPatientHistory({ patientId: known.identifier }, CTX);
        expect(r.patientName).toBe(`${known.firstName} ${known.lastName}`);
        expect(r.visits.map((v) => ({ date: v.visitDate, type: v.visitType }))).toEqual(world.visits);
        expect(r.total).toBe(world.visits.length);
        expect(r.hasMore).toBe(false);
        for (const v of r.visits) {
          expect(v.hasVitals).toBe(true);
          expect(v.duration).toBeGreaterThan(0);
          expect(v.id).toEqual(expect.any(String));
          expect(v.nurseName).not.toBe('');
        }
        const dates = r.visits.map((v) => v.visitDate);
        expect(dates).toEqual([...dates].sort().reverse());
      });

      test('the id a search returned gives the same history as the identifier', async () => {
        const found = await backend.searchPatients({ query: known.identifier, searchType: 'id' }, CTX);
        const byId = await backend.getPatientHistory({ patientId: found.results[0].id }, CTX);
        const byIdentifier = await backend.getPatientHistory({ patientId: known.identifier }, CTX);
        expect(byId.visits).toEqual(byIdentifier.visits);
      });

      test('limit pages through the visits in order and the total stays the same', async () => {
        const first = await backend.getPatientHistory({ patientId: known.identifier, limit: 1 }, CTX);
        expect(first.visits.map((v) => v.visitDate)).toEqual([world.visits[0].date]);
        expect(first).toMatchObject({ hasMore: true, total: world.visits.length });

        const second = await backend.getPatientHistory({ patientId: known.identifier, limit: 1, cursor: first.nextCursor }, CTX);
        expect(second.visits.map((v) => v.visitDate)).toEqual([world.visits[1].date]);
        expect(second.total).toBe(world.visits.length);
      });

      test('a date range keeps only visits on those days', async () => {
        const day = world.visits[0].date;
        const r = await backend.getPatientHistory({ patientId: known.identifier, startDate: day, endDate: day }, CTX);
        expect(r.visits.map((v) => v.visitDate)).toEqual([day]);
        expect(r.total).toBe(1);

        const older = world.visits[world.visits.length - 1].date;
        const before = await backend.getPatientHistory({ patientId: known.identifier, endDate: older }, CTX);
        expect(before.visits.map((v) => v.visitDate)).toEqual([older]);
      });

      test('a visit type filter keeps only that type', async () => {
        const { type, dates } = world.typeFilter;
        const r = await backend.getPatientHistory({ patientId: known.identifier, visitType: type }, CTX);
        expect(r.visits.map((v) => v.visitDate)).toEqual(dates);
        expect(r.visits.every((v) => v.visitType === type)).toBe(true);
        expect(r.total).toBe(dates.length);
      });

      test('an unknown patient is NotFound', async () => {
        await expect(backend.getPatientHistory({ patientId: world.unknownIdentifier }, CTX)).rejects.toThrow(NotFoundError);
      });

      test('a cursor this server did not issue is rejected', async () => {
        await expect(
          backend.getPatientHistory({ patientId: known.identifier, cursor: 'bm90LWEtY3Vyc29y.c2ln' }, CTX)
        ).rejects.toThrow(ValidationError);
      });
    });
  });
}
