/**
 * FHIR backend against an in-memory FHIR server: capability gates, fallbacks, checks on
 * what the server returns, and the write gates (plan PR6). All data is synthetic.
 */

import { describe, test, expect } from '@jest/globals';

import { FhirBackend } from '../../src/backends/fhir/fhir-backend.js';
import { PREFLIGHT_REFUSAL } from '../../src/backends/fhir/preflight.js';
import type { ValidatedVisitNote, WriteContext } from '../../src/backends/types.js';
import type { PatientSearchParams, PatientSearchResponse } from '../../src/types/index.js';
import {
  NotFoundError,
  NotImplementedError,
  UnsupportedServerError,
  ValidationError,
  WriteRefusedError,
} from '../../src/utils/errors.js';
import { BASE, CONFIG, SYS, encounter, fakeFhir, heartRate, nurseNote, patient } from '../support/fake-fhir.js';
import type { FakeOptions } from '../support/fake-fhir.js';

const CTX = { requestId: 'r1', timezone: 'America/New_York' };
const KEY = '00000000-0000-4000-8000-0000000000aa';
const WRITE_CTX: WriteContext = {
  ...CTX,
  practitioner: { reference: 'Practitioner/rn-1', display: 'Avery Quinn, RN', source: 'configured-sandbox' },
  idempotencyKey: KEY,
  dryRun: false,
};
const NOTE: ValidatedVisitNote = {
  patientId: 'PT-90001',
  visitType: 'skilled_nursing',
  visitDate: '2026-10-20',
  timeIn: '09:00',
  timeOut: '09:45',
};

const P1 = patient('p1', 'PT-90001', 'Tessa', 'Sample', { birthDate: '1940-01-02', telecom: [{ system: 'phone', value: '555-0111' }] });
const P2 = patient('p2', 'PT-90002', 'Tobias', 'Sample', { active: false });
const HH = encounter('e1', 'p1', '2026-10-20T09:00:00-04:00', '2026-10-20T09:45:00-04:00');
const OLDER = encounter('e2', 'p1', '2026-10-17T14:00:00-04:00', '2026-10-17T14:30:00-04:00', { visitType: 'physical_therapy' });
const AMB = encounter('e3', 'p1', '2026-10-18T10:00:00-04:00', '2026-10-18T10:20:00-04:00', {
  class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
});

function setup(opts: FakeOptions = {}, config = CONFIG) {
  const server = fakeFhir({ patients: [P1, P2], ...opts });
  return { server, backend: new FhirBackend({ config, timeoutMs: 1000, fetch: server.fetch }) };
}

const posts = (server: ReturnType<typeof fakeFhir>) => server.requests.filter((r) => r.method !== 'GET');

describe('startup probe', () => {
  test('accepts 4.0.x and reads /metadata once', async () => {
    const { server, backend } = setup();
    await backend.init();
    await backend.searchPatients({ query: 'PT-90001', searchType: 'id' }, CTX);
    await backend.searchPatients({ query: 'PT-90002', searchType: 'id' }, CTX);
    expect(server.requests.filter((r) => r.url.pathname.endsWith('/metadata'))).toHaveLength(1);
  });

  test.each(['4.3.0', '5.0.0', '3.0.2', ''])('rejects fhirVersion %j', async (fhirVersion) => {
    const { backend } = setup({ fhirVersion });
    await expect(backend.init()).rejects.toThrow(UnsupportedServerError);
    await expect(backend.init()).rejects.toThrow('must start with 4.0');
  });

  test('reports an unreadable /metadata by status and issue code only, then retries', async () => {
    let fail = true;
    const { server, backend } = setup({
      override: (req) =>
        fail && req.url.pathname.endsWith('/metadata')
          ? { status: 503, body: { resourceType: 'OperationOutcome', issue: [{ code: 'transient', diagnostics: 'db host 10.9.9.9 down' }] } }
          : undefined,
    });
    const error = await backend.init().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedServerError);
    expect((error as Error).message).toBe('cannot read FHIR /metadata (HTTP 503, transient)');
    fail = false;
    await expect(backend.init()).resolves.toBeUndefined();
    expect(server.requests).toHaveLength(2);
  });
});

describe('patient search', () => {
  test('identifier search returns the one patient with server id and identifier', async () => {
    const { backend } = setup();
    const r = await backend.searchPatients({ query: 'PT-90001', searchType: 'id' }, CTX);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ id: 'p1', identifier: 'PT-90001', firstName: 'Tessa', lastName: 'Sample' });
  });

  test('a name search ANDs the words and passes a date of birth as birthdate', async () => {
    const { server, backend } = setup();
    const r = await backend.searchPatients({ query: 'Sample, Tessa 1940-01-02', searchType: 'name' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['p1']);
    const q = server.queries('Patient')[0];
    expect(q.getAll('name')).toEqual(['Sample', 'Tessa']);
    expect(q.get('birthdate')).toBe('1940-01-02');
  });

  test('"all" merges the queries without duplicates', async () => {
    const { backend } = setup();
    const r = await backend.searchPatients({ query: 'p1' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['p1']);
  });

  test('phone search is refused when /metadata does not list it, and "all" leaves it out', async () => {
    const { server, backend } = setup({ hide: ['Patient.phone'] });
    await expect(backend.searchPatients({ query: '555-0111', searchType: 'phone' }, CTX)).rejects.toThrow(
      'phone search unsupported by this server'
    );
    await backend.searchPatients({ query: '555-0111' }, CTX);
    expect(server.queries('Patient').some((q) => q.has('phone'))).toBe(false);
  });

  test('phone search is sent when advertised', async () => {
    const { backend } = setup();
    const r = await backend.searchPatients({ query: '555-0111', searchType: 'phone' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['p1']);
  });

  test('status is filtered on the client; discharged and pending are refused', async () => {
    const { backend } = setup();
    const inactive = await backend.searchPatients({ query: 'Sample', searchType: 'name', status: 'inactive' }, CTX);
    expect(inactive.results.map((p) => p.id)).toEqual(['p2']);
    expect(inactive.total).toBe(1);
    for (const status of ['discharged', 'pending'] as const) {
      await expect(backend.searchPatients({ query: 'Sample', status }, CTX)).rejects.toThrow(ValidationError);
    }
  });

  test('search values are escaped so a comma or pipe cannot widen the query', async () => {
    const { server, backend } = setup();
    await backend.searchPatients({ query: 'PT-1,PT-2|x', searchType: 'id' }, CTX);
    expect(server.queries('Patient')[0].get('identifier')).toBe(`${SYS}/patient-id|PT-1\\,PT-2\\|x`);
  });

  test('a next link becomes a signed cursor; a link outside the base URL is never followed', async () => {
    const page = (next: string) => ({
      resourceType: 'Bundle',
      type: 'searchset',
      link: [{ relation: 'self', url: `${BASE}/Patient?name=Sample` }, { relation: 'next', url: next }],
      entry: [{ resource: P1, search: { mode: 'match' } }],
    });
    for (const [next, ok] of [
      [`${BASE}?_getpages=abc`, true],
      ['https://evil.test/r4?_getpages=abc', false],
      ['https://fhir.test/other?_getpages=abc', false],
      ['https://user:pw@fhir.test/r4?_getpages=abc', false],
    ] as const) {
      const { server, backend } = setup({
        override: (req) => {
          if (req.url.searchParams.has('_getpages')) {
            return { status: 200, body: { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: P2 }] } };
          }
          return req.url.pathname.endsWith('/Patient') ? { status: 200, body: page(next) } : undefined;
        },
      });
      const first = await backend.searchPatients({ query: 'Sample', searchType: 'name', limit: 1 }, CTX);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.nextCursor).not.toContain('_getpages');
      const second = backend.searchPatients({ query: 'Sample', searchType: 'name', cursor: first.nextCursor }, CTX);
      if (ok) {
        expect((await second).results.map((p) => p.id)).toEqual(['p2']);
      } else {
        await expect(second).rejects.toThrow('outside FHIR_BASE_URL');
        expect(server.requests.filter((r) => r.url.searchParams.has('_getpages'))).toHaveLength(0);
      }
    }
  });

  test('a cursor that was not issued here is rejected before any request', async () => {
    const { server, backend } = setup();
    await backend.init();
    const forged = `${Buffer.from(JSON.stringify({ k: 'search', urls: [`${BASE}/Patient`] })).toString('base64url')}.AAAA`;
    await expect(backend.searchPatients({ query: 'x', cursor: forged }, CTX)).rejects.toThrow(ValidationError);
    expect(server.queries('Patient')).toHaveLength(0);
  });
});

describe('patient resolution', () => {
  test('resolves by identifier, then by server id', async () => {
    const { backend } = setup();
    expect((await backend.getPatient({ identifier: 'PT-90001' }, CTX)).id).toEqual({ id: 'p1', mrn: 'PT-90001' });
    expect((await backend.getPatient({ serverId: 'p2' }, CTX)).id.id).toBe('p2');
  });

  test('an unknown patient is NotFound with no upstream text', async () => {
    const { backend } = setup();
    const error = await backend.getPatient({ serverId: 'nope' }, CTX).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(String((error as Error).message)).toBe('Patient not found');
    await expect(backend.getPatient({ identifier: 'PT-00000' }, CTX)).rejects.toThrow(NotFoundError);
  });

  test('patients returned by a server that ignored identifier do not count as a hit', async () => {
    const { backend } = setup({ ignore: ['Patient.identifier'] });
    await expect(backend.getPatient({ identifier: 'PT-00000' }, CTX)).rejects.toThrow(NotFoundError);
    await expect(backend.getPatientHistory({ patientId: 'PT-00000' }, CTX)).rejects.toThrow(NotFoundError);
  });

  test('an identifier shared by two patients is refused', async () => {
    const twin = patient('p9', 'PT-90001', 'Twin', 'Sample');
    const { backend } = setup({ patients: [P1, twin] });
    await expect(backend.getPatientHistory({ patientId: 'PT-90001' }, CTX)).rejects.toThrow('more than one patient');
  });

  test('a read that answers with a different patient is an error, not that patient', async () => {
    const { backend } = setup({
      override: (req) => (req.url.pathname.endsWith('/Patient/p1') ? { status: 200, body: P2 } : undefined),
    });
    await expect(backend.getPatient({ serverId: 'p1' }, CTX)).rejects.toMatchObject({ issueCodes: ['structure'] });
  });

  test('only matched entries are patients: an included or outcome entry is not a result', async () => {
    const { backend } = setup({
      override: (req) =>
        req.url.pathname.endsWith('/Patient') && req.url.searchParams.has('name')
          ? {
              status: 200,
              body: {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: [
                  { resource: P1, search: { mode: 'match' } },
                  { resource: P2, search: { mode: 'include' } },
                  { resource: patient('p3', 'PT-90003', 'Third', 'Sample'), search: { mode: 'outcome' } },
                ],
              },
            }
          : undefined,
    });
    const r = await backend.searchPatients({ query: 'Sample', searchType: 'name' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['p1']);
  });

  test('an id that is not a FHIR id never reaches a URL path', async () => {
    const { server, backend } = setup();
    await expect(backend.getPatientHistory({ patientId: '../Encounter/e1' }, CTX)).rejects.toThrow(NotFoundError);
    expect(server.requests.every((r) => !r.url.pathname.includes('..') && !r.url.pathname.includes('Encounter'))).toBe(true);
  });
});

describe('visit history', () => {
  const world: FakeOptions = {
    encounters: [OLDER, HH, AMB],
    observations: [heartRate('o1', 'p1', '2026-10-20T09:10:00-04:00', 'e1')],
    documents: [
      nurseNote('d1', 'p1', 'e1', HH.period as { start: string; end: string }),
      nurseNote('d2', 'p1', 'e2', OLDER.period as { start: string; end: string }, 'final'),
    ],
  };

  test('lists home health visits newest first with status from the note and linked vitals', async () => {
    const { server, backend } = setup(world);
    const r = await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX);
    expect(r).toMatchObject({ patientId: 'p1', patientName: 'Tessa Sample', total: 2, hasMore: false });
    expect(r.visits).toEqual([
      { id: 'e1', visitDate: '2026-10-20', visitType: 'skilled_nursing', status: 'pending_review', duration: 45, nurseName: '', hasVitals: true },
      { id: 'e2', visitDate: '2026-10-17', visitType: 'physical_therapy', status: 'completed', duration: 30, nurseName: '', hasVitals: false },
    ]);
    const q = server.queries('Encounter')[0];
    expect(q.get('class')).toBe('http://terminology.hl7.org/CodeSystem/v3-ActCode|HH');
    expect(q.getAll('_revinclude')).toEqual(['Observation:encounter', 'DocumentReference:encounter']);
  });

  test('without _revinclude in /metadata it uses the DocumentReference query', async () => {
    const { server, backend } = setup({ ...world, noRevInclude: true });
    const r = await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX);
    expect(server.queries('Encounter')).toHaveLength(0);
    const q = server.queries('DocumentReference')[0];
    expect(q.get('patient')).toBe('p1');
    expect(q.get('category')).toBe('http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category|clinical-note');
    expect(r.visits.map((v) => [v.id, v.visitDate, v.status])).toEqual([
      ['e1', '2026-10-20', 'pending_review'],
      ['e2', '2026-10-17', 'completed'],
    ]);
    // Vitals are found by time, because nothing was included.
    expect(r.visits[0].hasVitals).toBe(true);
    await expect(backend.getPatientHistory({ patientId: 'PT-90001', visitType: 'skilled_nursing' }, CTX)).rejects.toThrow(
      'cannot filter visits by type'
    );
  });

  test('an Observation with no encounter link still gives hasVitals true', async () => {
    const { server, backend } = setup({
      encounters: [HH],
      observations: [heartRate('o2', 'p1', '2026-10-20T09:20:00-04:00')],
    });
    const r = await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX);
    expect(r.visits[0].hasVitals).toBe(true);
    const q = server.queries('Observation')[0];
    expect(q.get('patient')).toBe('p1');
    expect(q.getAll('date')).toEqual(['ge2026-10-20T09:00:00-04:00', 'le2026-10-20T09:45:00-04:00']);
  });

  test('vitals taken outside the visit, or for another patient, do not count', async () => {
    const { backend } = setup({
      encounters: [HH],
      observations: [heartRate('o3', 'p1', '2026-10-20T12:00:00-04:00'), heartRate('o4', 'p2', '2026-10-20T09:20:00-04:00')],
    });
    expect((await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX)).visits[0].hasVitals).toBe(false);
  });

  test('an entered-in-error reading or a non-vital observation is not vitals', async () => {
    const wrong = { ...heartRate('o5', 'p1', '2026-10-20T09:10:00-04:00', 'e1'), status: 'entered-in-error' as const };
    const lab = {
      ...heartRate('o6', 'p1', '2026-10-20T09:15:00-04:00', 'e1'),
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] },
    };
    const { backend } = setup({ encounters: [HH], observations: [wrong, lab] });
    expect((await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX)).visits[0].hasVitals).toBe(false);
  });

  test('with class and type hidden in /metadata the query omits them and filters on the client', async () => {
    const { server, backend } = setup({ ...world, hide: ['Encounter.class', 'Encounter.type'], ignore: ['Encounter.class', 'Encounter.type'] });
    const all = await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX);
    const q = server.queries('Encounter')[0];
    expect(q.has('class')).toBe(false);
    expect(q.has('type')).toBe(false);
    expect(all.visits.map((v) => v.id)).toEqual(['e1', 'e2']);
    expect(all.total).toBe(2);

    const pt = await backend.getPatientHistory({ patientId: 'PT-90001', visitType: 'physical_therapy' }, CTX);
    expect(server.queries('Encounter')[1].has('type')).toBe(false);
    expect(pt.visits.map((v) => v.id)).toEqual(['e2']);
    expect(pt.total).toBe(1);
  });

  test('a server that advertises class but ignores it is still filtered, and its total is not used', async () => {
    const { backend } = setup({ ...world, ignore: ['Encounter.class', 'Encounter.type'] });
    const r = await backend.getPatientHistory({ patientId: 'PT-90001', visitType: 'skilled_nursing' }, CTX);
    expect(r.visits.map((v) => v.id)).toEqual(['e1']);
    expect(r.total).toBe(1);
  });

  test('the date range is sent as local-day bounds and re-checked on the local start date', async () => {
    // 23:30 on the 19th in New York overlaps a search starting on the 20th in UTC terms.
    const late = encounter('e4', 'p1', '2026-10-19T23:30:00-04:00', '2026-10-20T00:15:00-04:00');
    const { server, backend } = setup({ encounters: [HH, late] });
    const r = await backend.getPatientHistory({ patientId: 'PT-90001', startDate: '2026-10-20', endDate: '2026-10-20' }, CTX);
    expect(server.queries('Encounter')[0].getAll('date')).toEqual(['ge2026-10-20T00:00:00-04:00', 'lt2026-10-21T00:00:00-04:00']);
    expect(r.visits.map((v) => v.id)).toEqual(['e1']);
    expect(r.total).toBe(1);
  });

  test("a history cursor is bound to its patient and keeps its filters", async () => {
    const pageOne = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 2,
      link: [
        { relation: 'self', url: `${BASE}/Encounter?patient=p1&class=HH&type=x` },
        { relation: 'next', url: `${BASE}?_getpages=abc&_getpagesoffset=1` },
      ],
      entry: [{ resource: HH, search: { mode: 'match' } }],
    };
    const pageTwo = { resourceType: 'Bundle', type: 'searchset', total: 2, entry: [{ resource: OLDER }, { resource: AMB }] };
    const { backend } = setup({
      encounters: [HH, OLDER],
      override: (req) => {
        if (req.url.searchParams.has('_getpages')) return { status: 200, body: pageTwo };
        return req.url.pathname.endsWith('/Encounter') ? { status: 200, body: pageOne } : undefined;
      },
    });
    const first = await backend.getPatientHistory({ patientId: 'PT-90001', limit: 1 }, CTX);
    expect(first.visits.map((v) => v.id)).toEqual(['e1']);
    expect(first).toMatchObject({ hasMore: true, total: 2 });

    const second = await backend.getPatientHistory({ patientId: 'p1', cursor: first.nextCursor }, CTX);
    // The AMB encounter on page two is still filtered out.
    expect(second.visits.map((v) => v.id)).toEqual(['e2']);
    expect(second).toMatchObject({ hasMore: false, total: 2 });

    await expect(backend.getPatientHistory({ patientId: 'PT-90002', cursor: first.nextCursor }, CTX)).rejects.toThrow(
      'cursor belongs to a different patient'
    );
    const search = await backend.searchPatients({ query: 'x', cursor: first.nextCursor }, CTX).catch((e: unknown) => e);
    expect(search).toBeInstanceOf(ValidationError);
  });

  test('an upstream failure surfaces as status and issue codes only', async () => {
    const { backend } = setup({
      override: (req) =>
        req.url.pathname.endsWith('/Encounter')
          ? { status: 500, body: { resourceType: 'OperationOutcome', issue: [{ code: 'exception', diagnostics: 'Tessa Sample PT-90001 stack trace' }] } }
          : undefined,
    });
    const error = (await backend.getPatientHistory({ patientId: 'PT-90001' }, CTX).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Upstream request failed (HTTP 500: exception)');
    expect(JSON.stringify(error)).not.toContain('Tessa');
  });
});

describe('write gates (the write itself is not in this build)', () => {
  const unrelated = encounter('e9', 'p2', '2026-09-01T09:00:00-04:00', '2026-09-01T09:30:00-04:00', {
    identifier: [{ system: `${SYS}/visit`, value: 'some-other-visit' }],
  });

  test('FHIR_WRITE off: refused before any HTTP call', async () => {
    const { server, backend } = setup({}, { ...CONFIG, write: false });
    await expect(backend.createVisitNote(NOTE, WRITE_CTX)).rejects.toThrow(WriteRefusedError);
    expect(server.requests).toHaveLength(0);
  });

  test('a server that ignores identifier (self link lacks it): refused with 0 POSTs', async () => {
    const { server, backend } = setup({ encounters: [unrelated], ignore: ['Encounter.identifier'] });
    const error = await backend.createVisitNote(NOTE, WRITE_CTX).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteRefusedError);
    expect((error as Error).message).toBe(PREFLIGHT_REFUSAL);
    expect(posts(server)).toHaveLength(0);
    const q = server.requests.find((r) => r.url.pathname.endsWith('/Encounter'))!;
    expect(q.url.searchParams.get('identifier')).toBe(`${SYS}/visit|${KEY}`);
    expect(q.headers.prefer).toBe('handling=strict');
  });

  test('/metadata without Encounter identifier search: refused with 0 POSTs and no pre-flight query', async () => {
    const { server, backend } = setup({ encounters: [unrelated], hide: ['Encounter.identifier'] });
    await expect(backend.createVisitNote(NOTE, WRITE_CTX)).rejects.toThrow(PREFLIGHT_REFUSAL);
    expect(posts(server)).toHaveLength(0);
    expect(server.queries('Encounter')).toHaveLength(0);
  });

  test('a self link that claims identifier but returns an Encounter without it: refused', async () => {
    const { server, backend } = setup({
      override: (req) =>
        req.url.pathname.endsWith('/Encounter')
          ? {
              status: 200,
              body: {
                resourceType: 'Bundle',
                type: 'searchset',
                link: [{ relation: 'self', url: req.url.href }],
                entry: [{ resource: unrelated }],
              },
            }
          : undefined,
    });
    await expect(backend.createVisitNote(NOTE, WRITE_CTX)).rejects.toThrow(PREFLIGHT_REFUSAL);
    expect(posts(server)).toHaveLength(0);
  });

  test('a Bundle with no self link: refused', async () => {
    const { backend } = setup({
      override: (req) =>
        req.url.pathname.endsWith('/Encounter') ? { status: 200, body: { resourceType: 'Bundle', type: 'searchset' } } : undefined,
    });
    await expect(backend.createVisitNote(NOTE, WRITE_CTX)).rejects.toThrow(PREFLIGHT_REFUSAL);
  });

  test('an unknown patient is NotFound before the pre-flight', async () => {
    const { server, backend } = setup();
    await expect(backend.createVisitNote({ ...NOTE, patientId: 'PT-00000' }, WRITE_CTX)).rejects.toThrow(NotFoundError);
    expect(server.queries('Encounter')).toHaveLength(0);
  });

  test('when every gate passes the write still stops at NotImplemented with 0 POSTs', async () => {
    const { server, backend } = setup({ encounters: [unrelated] });
    await expect(backend.createVisitNote(NOTE, WRITE_CTX)).rejects.toThrow(NotImplementedError);
    expect(posts(server)).toHaveLength(0);
    expect(server.queries('Encounter')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Review hardening: paging, checks on what the server returns, write gate
// ---------------------------------------------------------------------------

/** Follow cursors to the end. `follow` replaces the request on every page after the first. */
async function searchPages(backend: FhirBackend, first: PatientSearchParams, follow: Partial<PatientSearchParams> = {}) {
  const pages = [await backend.searchPatients(first, CTX)];
  for (;;) {
    const cursor = pages[pages.length - 1].nextCursor;
    if (!cursor) return pages;
    if (pages.length > 20) throw new Error('paging did not end');
    pages.push(await backend.searchPatients({ ...first, ...follow, cursor }, CTX));
  }
}
const idsOf = (pages: PatientSearchResponse[]) => pages.flatMap((p) => p.results.map((r) => r.id));

describe('patient search paging', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((x, i) =>
    patient(`s${x}`, `PT-9100${i}`, 'Sam', 'Paging', { active: i % 2 === 0 })
  );

  test('several queries matching more than one page holds: nothing is dropped', async () => {
    // "paging" is one patient's server id and two other patients' family name.
    const byId = patient('paging', 'PT-91010', 'Zed', 'Other');
    const { backend } = setup({ patients: [byId, five[0], five[1]] });
    const pages = await searchPages(backend, { query: 'paging', limit: 2 });
    expect(pages.map((p) => p.results.length)).toEqual([2, 1]);
    expect(idsOf(pages).sort()).toEqual(['paging', 'sa', 'sb']);
    expect(pages[0]).toMatchObject({ total: 3, hasMore: true });
    expect(pages[0].totalIsLowerBound).toBeUndefined();
  });

  test('a patient two queries match on different pages is listed once', async () => {
    const both = patient('paging', 'PT-91011', 'Sam', 'Paging');
    const { backend } = setup({ patients: [five[0], five[1], both] });
    const pages = await searchPages(backend, { query: 'paging', limit: 2 });
    expect(idsOf(pages).sort()).toEqual(['paging', 'sa', 'sb']);
    expect(pages[pages.length - 1]).toMatchObject({ total: 3, hasMore: false });
  });

  test('a cursor followed with a smaller limit skips nothing', async () => {
    const { backend } = setup({ patients: five });
    const pages = await searchPages(backend, { query: 'Paging', searchType: 'name', limit: 3 }, { limit: 1 });
    expect(pages.map((p) => p.results.length)).toEqual([3, 1, 1]);
    expect(idsOf(pages)).toEqual(['sa', 'sb', 'sc', 'sd', 'se']);
    expect(pages.every((p) => p.total === 5)).toBe(true);
  });

  test('the status filter travels in the cursor; the total says when it is a lower bound', async () => {
    const { backend } = setup({ patients: five });
    const pages = await searchPages(
      backend,
      { query: 'Paging', searchType: 'name', status: 'active', limit: 2 },
      { status: 'inactive' }
    );
    expect(idsOf(pages)).toEqual(['sa', 'sc', 'se']);
    expect(pages.flatMap((p) => p.results.map((r) => r.status))).toEqual(['active', 'active', 'active']);
    expect(pages[0]).toMatchObject({ total: 1, totalIsLowerBound: true });
    expect(pages[pages.length - 1].total).toBe(3);
    expect(pages[pages.length - 1].totalIsLowerBound).toBeUndefined();
  });

  test('a page emptied by the status filter still hands out the next cursor', async () => {
    const { backend } = setup({ patients: five });
    const first = await backend.searchPatients({ query: 'Paging', searchType: 'name', status: 'inactive', limit: 1 }, CTX);
    expect(first.results).toEqual([]);
    expect(first).toMatchObject({ hasMore: true, totalIsLowerBound: true });
    const second = await backend.searchPatients({ query: 'Paging', cursor: first.nextCursor }, CTX);
    expect(second.results.map((r) => r.id)).toEqual(['sb']);
  });

  test('a phone search also asks for the digits-only spelling', async () => {
    const stored = patient('ph', 'PT-91020', 'Pho', 'Ne', { telecom: [{ system: 'phone', value: '5550144' }] });
    const { server, backend } = setup({ patients: [stored] });
    const r = await backend.searchPatients({ query: '(555) 0144', searchType: 'phone' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['ph']);
    expect(server.queries('Patient')[0].get('phone')).toBe('(555) 0144,5550144');
  });
});

describe('patient resolution (review)', () => {
  test('the same value under another identifier system is not this patient', async () => {
    const other = patient('px', 'unused', 'Other', 'System', { identifier: [{ system: 'urn:other', value: 'PT-90009' }] });
    const { backend } = setup({ patients: [P1, other], ignore: ['Patient.identifier'] });
    await expect(backend.getPatient({ identifier: 'PT-90009' }, CTX)).rejects.toThrow(NotFoundError);
    await expect(backend.getPatientHistory({ patientId: 'PT-90009' }, CTX)).rejects.toThrow(NotFoundError);
  });

  test('a resolved patient carries the reference later writes point at', async () => {
    const { backend } = setup();
    expect((await backend.getPatient({ serverId: 'p1' }, CTX)).reference).toBe('Patient/p1');
    expect((await backend.getPatient({ identifier: 'PT-90002' }, CTX)).reference).toBe('Patient/p2');
  });
});

describe('visit history (review)', () => {
  const period = (e: { period?: { start?: string; end?: string } }) => e.period as { start: string; end: string };
  const documentsOnly: FakeOptions = { noRevInclude: true };

  test("another patient's Encounter in the answer is dropped", async () => {
    const theirs = encounter('x1', 'p2', '2026-10-21T09:00:00-04:00', '2026-10-21T09:30:00-04:00');
    const { backend } = setup({ encounters: [HH, theirs], ignore: ['Encounter.patient'] });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits.map((v) => v.id)).toEqual(['e1']);
    expect(r.total).toBe(1);
  });

  test('entered-in-error is not a visit, unknown needs review, cancelled stays cancelled', async () => {
    const at = (day: string) => [`2026-10-${day}T09:00:00-04:00`, `2026-10-${day}T09:30:00-04:00`] as const;
    const wrong = encounter('s1', 'p1', ...at('11'), { status: 'entered-in-error' });
    const unknown = encounter('s2', 'p1', ...at('12'), { status: 'unknown' });
    const cancelled = encounter('s3', 'p1', ...at('13'), { status: 'cancelled' });
    const finished = encounter('s4', 'p1', ...at('14'));
    const { backend } = setup({
      encounters: [wrong, unknown, cancelled, finished],
      documents: [nurseNote('n3', 'p1', 's3', period(cancelled))],
    });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits.map((v) => [v.id, v.status])).toEqual([
      ['s4', 'completed'],
      ['s3', 'cancelled'],
      ['s2', 'pending_review'],
    ]);
  });

  test('a visit with no start date is listed, but cannot pass a date filter', async () => {
    const undated = encounter('u1', 'p1', '', '', { period: undefined });
    const { backend } = setup({ encounters: [undated, HH], ignore: ['Encounter.date'] });
    const all = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(all.visits.map((v) => [v.id, v.visitDate])).toEqual([['e1', '2026-10-20'], ['u1', '']]);
    const filtered = await backend.getPatientHistory({ patientId: 'p1', startDate: '2026-10-01' }, CTX);
    expect(filtered.visits.map((v) => v.id)).toEqual(['e1']);
  });

  test('vitals fallback: only this patient, only during the visit', async () => {
    const theirs = heartRate('v1', 'p2', '2026-10-20T09:10:00-04:00');
    const otherDay = heartRate('v2', 'p1', '2026-10-19T09:10:00-04:00');
    for (const [observations, ignore] of [
      [[theirs], ['Observation.patient']],
      [[otherDay], ['Observation.date']],
    ] as const) {
      const { backend } = setup({ encounters: [HH], observations: [...observations], ignore: [...ignore] });
      const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
      expect(r.visits.map((v) => v.hasVitals)).toEqual([false]);
    }
  });

  test('vitals fallback: a visit still open looks to the end of its local day', async () => {
    const open = encounter('o1', 'p1', '2026-10-20T22:00:00-04:00', '', {
      status: 'in-progress',
      period: { start: '2026-10-20T22:00:00-04:00' },
    });
    const sameNight = heartRate('v3', 'p1', '2026-10-20T23:30:00-04:00');
    const { server, backend } = setup({ encounters: [open], observations: [sameNight] });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits).toMatchObject([{ id: 'o1', status: 'in_progress', hasVitals: true }]);
    expect(server.queries('Observation')[0].getAll('date')).toEqual([
      'ge2026-10-20T22:00:00-04:00',
      'le2026-10-21T00:00:00-04:00',
    ]);
    // The next morning's reading belongs to another day.
    const next = setup({ encounters: [open], observations: [heartRate('v4', 'p1', '2026-10-21T08:00:00-04:00')] });
    expect((await next.backend.getPatientHistory({ patientId: 'p1' }, CTX)).visits[0].hasVitals).toBe(false);
  });

  test('a history cursor keeps its visit type, dates and page size', async () => {
    const pt = (id: string, day: string) =>
      encounter(id, 'p1', `2026-10-${day}T14:00:00-04:00`, `2026-10-${day}T14:30:00-04:00`, { visitType: 'physical_therapy' });
    const world: FakeOptions = { encounters: [pt('t1', '15'), HH, pt('t2', '16'), pt('t3', '02'), pt('t4', '17')] };
    const { backend } = setup(world);
    const ask = { patientId: 'p1', visitType: 'physical_therapy', startDate: '2026-10-10', limit: 1 } as const;
    const seen: string[] = [];
    let page = await backend.getPatientHistory(ask, CTX);
    for (;;) {
      seen.push(...page.visits.map((v) => v.id));
      expect(page.limit).toBe(1);
      if (!page.nextCursor) break;
      // The follow-up asks for something else; the cursor's own filters win.
      page = await backend.getPatientHistory(
        { patientId: 'p1', visitType: 'skilled_nursing', startDate: '2020-01-01', limit: 50, cursor: page.nextCursor },
        CTX
      );
    }
    // t3 is before the start date; the fake does not filter Encounter by date, the client does.
    expect(seen.sort()).toEqual(['t1', 't2', 't4']);
  });

  test('the total is a lower bound while filtered pages remain', async () => {
    const pt = encounter('t1', 'p1', '2026-10-15T14:00:00-04:00', '2026-10-15T14:30:00-04:00', { visitType: 'physical_therapy' });
    const { backend } = setup({ encounters: [HH, pt], ignore: ['Encounter.type'] });
    const first = await backend.getPatientHistory({ patientId: 'p1', visitType: 'physical_therapy', limit: 1 }, CTX);
    expect(first).toMatchObject({ visits: [], total: 0, totalIsLowerBound: true, hasMore: true });
    const second = await backend.getPatientHistory({ patientId: 'p1', cursor: first.nextCursor }, CTX);
    expect(second.visits.map((v) => v.id)).toEqual(['t1']);
    expect(second.total).toBe(1);
    expect(second.totalIsLowerBound).toBeUndefined();
  });

  test('_revinclude gate: the two values must be listed, in either spelling', async () => {
    const provenanceOnly = setup({ encounters: [HH], revInclude: ['Provenance:target'] });
    await provenanceOnly.backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(provenanceOnly.server.queries('Encounter')).toHaveLength(0);
    expect(provenanceOnly.server.queries('DocumentReference')).toHaveLength(1);

    const oneOfTwo = setup({ encounters: [HH], revInclude: ['Observation:encounter'] });
    await oneOfTwo.backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(oneOfTwo.server.queries('Encounter')).toHaveLength(0);

    const threePart = setup({
      encounters: [HH],
      revInclude: ['Observation:encounter:Encounter', 'DocumentReference:encounter:Encounter'],
    });
    await threePart.backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(threePart.server.queries('Encounter')).toHaveLength(1);
  });

  test('documents mode: one row per visit, only current nurse notes of this patient', async () => {
    const theirs = nurseNote('d9', 'p2', 'e9', period(HH));
    const superseded = { ...nurseNote('d8', 'p1', 'e8', period(HH)), status: 'superseded' as const };
    const discharge = { ...nurseNote('d7', 'p1', 'e7', period(HH)), type: { coding: [{ system: 'http://loinc.org', code: '18842-5' }] } };
    const { backend } = setup({
      ...documentsOnly,
      documents: [
        nurseNote('d1', 'p1', 'e1', period(HH)),
        nurseNote('d2', 'p1', 'e1', period(HH), 'final'),
        theirs,
        superseded,
        discharge,
      ],
      ignore: ['DocumentReference.patient'],
    });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits).toMatchObject([{ id: 'e1', visitDate: '2026-10-20', status: 'pending_review', duration: 45 }]);
    expect(r.visits).toHaveLength(1);
  });

  test('documents mode: a note written the next day is still found by the visit date', async () => {
    const late = { ...nurseNote('d1', 'p1', 'e1', period(HH)), date: '2026-10-21T08:00:00-04:00' };
    const { server, backend } = setup({ ...documentsOnly, documents: [late] });
    const r = await backend.getPatientHistory({ patientId: 'p1', startDate: '2026-10-20', endDate: '2026-10-20' }, CTX);
    expect(r.visits.map((v) => v.id)).toEqual(['e1']);
    // Only the lower bound goes to the server; the note date is not the visit date.
    expect(server.queries('DocumentReference')[0].getAll('date')).toEqual(['ge2026-10-20T00:00:00-04:00']);
    const dayAfter = await backend.getPatientHistory({ patientId: 'p1', startDate: '2026-10-21' }, CTX);
    expect(dayAfter.visits).toEqual([]);
  });
});

describe('write gates (review)', () => {
  test('a note-only write has no duplicate check yet: refused with 0 POSTs', async () => {
    const byConfig = setup({}, { ...CONFIG, writeProfile: 'note-only' });
    const byServer = setup({ noInteraction: ['Encounter.create'] });
    for (const { server, backend } of [byConfig, byServer]) {
      const error = await backend.createVisitNote(NOTE, WRITE_CTX).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WriteRefusedError);
      expect((error as Error).message).toContain('note-only write has no duplicate check');
      expect(posts(server)).toHaveLength(0);
      expect(server.queries('Encounter')).toHaveLength(0);
    }
  });
});

describe('second review: search cursors', () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const many = (n: number) => Array.from({ length: n }, (_, i) => patient(uuid(i), `PT-8${String(i).padStart(4, '0')}`, 'Sam', 'Paging'));
  const walk = async (backend: FhirBackend, first: PatientSearchParams) => {
    const pages: PatientSearchResponse[] = [await backend.searchPatients(first, CTX)];
    while (pages[pages.length - 1].nextCursor && pages.length < 500) {
      pages.push(await backend.searchPatients({ query: first.query, cursor: pages[pages.length - 1].nextCursor }, CTX));
    }
    return pages;
  };

  test('one query: the cursor does not grow with the pages read', async () => {
    const { backend } = setup({ patients: many(300) });
    const pages = await walk(backend, { query: 'Paging', searchType: 'name', limit: 2 });
    expect(pages.flatMap((p) => p.results)).toHaveLength(300);
    const sizes = pages.flatMap((p) => (p.nextCursor ? [p.nextCursor.length] : []));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(16);
  });

  test('several queries: every page of a long result is reachable and the cursor stays under the 8192 cap', async () => {
    const { backend } = setup({ patients: many(700) });
    const pages = await walk(backend, { query: 'Paging', limit: 50 });
    const ids = pages.flatMap((p) => p.results.map((r) => r.id));
    expect(new Set(ids).size).toBe(700);
    expect(ids).toHaveLength(700);
    expect(Math.max(...pages.map((p) => p.nextCursor?.length ?? 0))).toBeLessThan(8192);
  });

  test('a next link that points at the page just read ends the paging', async () => {
    const { backend } = setup({
      patients: many(3),
      override: (req) =>
        req.url.searchParams.has('_offset')
          ? {
              status: 200,
              body: {
                resourceType: 'Bundle',
                type: 'searchset',
                link: [{ relation: 'next', url: req.url.href }],
                entry: [{ resource: many(3)[2], search: { mode: 'match' } }],
              },
            }
          : undefined,
    });
    const first = await backend.searchPatients({ query: 'Paging', searchType: 'name', limit: 2 }, CTX);
    const second = await backend.searchPatients({ query: 'Paging', cursor: first.nextCursor }, CTX);
    expect(second.results.map((r) => r.id)).toEqual([uuid(2)]);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeUndefined();
  });

  test('searches ask for a stable order, since a merge can re-run them', async () => {
    const { server, backend } = setup();
    await backend.searchPatients({ query: 'Sample' }, CTX);
    expect(server.queries('Patient').map((q) => q.get('_sort'))).toEqual(server.queries('Patient').map(() => '_id'));
  });
});

describe('second review: visit history', () => {
  const at = (day: string) => ({ start: `2026-10-${day}T09:00:00-04:00`, end: `2026-10-${day}T09:30:00-04:00` });
  const history = async (backend: FhirBackend, first: Parameters<FhirBackend['getPatientHistory']>[0]) => {
    const pages = [await backend.getPatientHistory(first, CTX)];
    while (pages[pages.length - 1].nextCursor && pages.length < 50) {
      pages.push(await backend.getPatientHistory({ patientId: first.patientId, cursor: pages[pages.length - 1].nextCursor }, CTX));
    }
    return pages;
  };

  test('documents mode: a visit whose notes fall on two pages is listed once', async () => {
    const { backend } = setup({
      noRevInclude: true,
      documents: [
        nurseNote('d3', 'p1', 'e2', at('22'), 'final'),
        nurseNote('d2', 'p1', 'e1', at('20'), 'final'),
        nurseNote('d1', 'p1', 'e1', at('20')),
        nurseNote('d0', 'p1', 'e0', at('12'), 'final'),
      ],
    });
    const pages = await history(backend, { patientId: 'p1', limit: 2 });
    expect(pages.map((p) => p.visits.map((v) => v.id))).toEqual([['e2', 'e1'], ['e0']]);
    expect(pages[pages.length - 1]).toMatchObject({ total: 3, hasMore: false });
  });

  test('a later page that drops a row stops the total being reported as exact', async () => {
    const good = encounter('g1', 'p1', at('20').start, at('20').end);
    const wrong = encounter('w1', 'p1', at('19').start, at('19').end, { status: 'entered-in-error' });
    const { backend } = setup({ encounters: [good, wrong] });
    const pages = await history(backend, { patientId: 'p1', limit: 1 });
    expect(pages.map((p) => p.visits.length)).toEqual([1, 0]);
    expect(pages[1].total).toBe(1);
    expect(pages[1].totalIsLowerBound).toBeUndefined();
  });

  test('a clean paged history keeps the server total on every page', async () => {
    const { backend } = setup({ encounters: [HH, OLDER] });
    const pages = await history(backend, { patientId: 'p1', limit: 1 });
    expect(pages.map((p) => [p.total, p.totalIsLowerBound])).toEqual([[2, undefined], [2, undefined]]);
  });

  test('a server that ignores the date filter does not get its total trusted', async () => {
    const { backend } = setup({ encounters: [HH, OLDER], ignore: ['Encounter.date'] });
    const first = await backend.getPatientHistory({ patientId: 'p1', startDate: '2026-10-19', limit: 1 }, CTX);
    expect(first.visits.map((v) => v.id)).toEqual(['e1']);
    expect(first).toMatchObject({ total: 1, totalIsLowerBound: true });
  });

  test('a next link that points at the page just read ends the history', async () => {
    const { backend } = setup({
      encounters: [HH, OLDER],
      override: (req) =>
        req.url.pathname.endsWith('/Encounter') && req.url.searchParams.has('_offset')
          ? {
              status: 200,
              body: {
                resourceType: 'Bundle',
                type: 'searchset',
                link: [{ relation: 'next', url: req.url.href }],
                entry: [{ resource: OLDER, search: { mode: 'match' } }],
              },
            }
          : undefined,
    });
    const pages = await history(backend, { patientId: 'p1', limit: 1 });
    expect(pages.map((p) => p.visits.map((v) => v.id))).toEqual([['e1'], ['e2']]);
    expect(pages[1].hasMore).toBe(false);
  });

  test('a period given as bare dates is read as local days', async () => {
    const dayOnly = encounter('b1', 'p1', '', '', { period: { start: '2026-10-20', end: '2026-10-20' } });
    const endOnly = encounter('b2', 'p1', '', '', { period: { start: '2026-10-18T09:00:00-04:00', end: '2026-10-18' } });
    const during = heartRate('h1', 'p1', '2026-10-18T09:10:00-04:00');
    const { backend } = setup({ encounters: [dayOnly, endOnly], observations: [during], ignore: ['Observation.date'] });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits.map((v) => [v.id, v.visitDate, v.hasVitals])).toEqual([
      ['b1', '2026-10-20', false],
      ['b2', '2026-10-18', true],
    ]);
    // The morning after is another day.
    const after = setup({
      encounters: [endOnly],
      observations: [heartRate('h2', 'p1', '2026-10-19T08:00:00-04:00')],
      ignore: ['Observation.date'],
    });
    expect((await after.backend.getPatientHistory({ patientId: 'p1' }, CTX)).visits[0].hasVitals).toBe(false);
  });

  test('a bare month or year has no day; its end covers the whole month or year', async () => {
    const month = encounter('m1', 'p1', '', '', { period: { start: '2026-10', end: '2026-12' } });
    const { backend } = setup({ encounters: [month] });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits.map((v) => [v.id, v.visitDate])).toEqual([['m1', '']]);
    const open = encounter('y1', 'p1', '', '', { period: { start: '2026-12-31T22:00:00-05:00', end: '2026' } });
    for (const [when, want] of [['2026-12-31T23:30:00-05:00', true], ['2027-01-01T00:30:00-05:00', false]] as const) {
      const s = setup({ encounters: [open], observations: [heartRate('h3', 'p1', when)], ignore: ['Observation.date'] });
      expect((await s.backend.getPatientHistory({ patientId: 'p1' }, CTX)).visits[0].hasVitals).toBe(want);
    }
    const dec = encounter('y2', 'p1', '', '', { period: { start: '2026-11-30T22:00:00-05:00', end: '2026-11' } });
    for (const [when, want] of [['2026-11-30T23:30:00-05:00', true], ['2026-12-01T00:30:00-05:00', false]] as const) {
      const s = setup({ encounters: [dec], observations: [heartRate('h4', 'p1', when)], ignore: ['Observation.date'] });
      expect((await s.backend.getPatientHistory({ patientId: 'p1' }, CTX)).visits[0].hasVitals).toBe(want);
    }
  });

  test("another patient's included vital or note, or a note of another kind, does not count", async () => {
    const open = encounter('i1', 'p1', at('20').start, at('20').end, { status: 'in-progress' });
    const theirVital = heartRate('h5', 'p2', '2026-10-20T09:10:00-04:00', 'i1');
    const theirNote = nurseNote('n5', 'p2', 'i1', at('20'), 'final');
    const otherKind = { ...nurseNote('n6', 'p1', 'i1', at('20'), 'final'), type: { coding: [{ system: 'http://loinc.org', code: '11506-3' }] } };
    const { backend } = setup({ encounters: [open], observations: [theirVital], documents: [theirNote, otherKind] });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r.visits).toMatchObject([{ id: 'i1', status: 'in_progress', hasVitals: false }]);
  });
});

describe('second review: history totals and month ends', () => {
  const day = (id: string, d: string, extra: Parameters<typeof encounter>[4] = {}) =>
    encounter(id, 'p1', `2026-10-${d}T09:00:00-04:00`, `2026-10-${d}T09:30:00-04:00`, extra);
  const pagesOf = async (backend: FhirBackend, limit: number) => {
    const pages = [await backend.getPatientHistory({ patientId: 'p1', limit }, CTX)];
    while (pages[pages.length - 1].nextCursor && pages.length < 20) {
      pages.push(await backend.getPatientHistory({ patientId: 'p1', cursor: pages[pages.length - 1].nextCursor }, CTX));
    }
    return pages;
  };

  test('a middle page that drops a row turns the total into a lower bound from there on', async () => {
    const { backend } = setup({ encounters: [day('k1', '20'), day('k2', '19', { status: 'entered-in-error' }), day('k3', '18')] });
    const pages = await pagesOf(backend, 1);
    expect(pages.map((p) => [p.visits.length, p.total, p.totalIsLowerBound])).toEqual([
      [1, 3, undefined],
      [0, 1, true],
      [1, 2, undefined],
    ]);
  });

  test('a later page with no self link still inherits the trusted total', async () => {
    const three = [day('k1', '20'), day('k2', '19'), day('k3', '18')];
    const { backend } = setup({
      encounters: three,
      override: (req) => {
        if (!req.url.pathname.endsWith('/Encounter') || req.url.searchParams.get('_offset') !== '1') return undefined;
        const next = new URL(req.url.href);
        next.searchParams.set('_offset', '2');
        return {
          status: 200,
          body: {
            resourceType: 'Bundle',
            type: 'searchset',
            link: [{ relation: 'next', url: next.href }],
            entry: [{ resource: three[1], search: { mode: 'match' } }],
          },
        };
      },
    });
    const pages = await pagesOf(backend, 1);
    expect(pages.map((p) => [p.visits.length, p.total, p.totalIsLowerBound])).toEqual([
      [1, 3, undefined],
      [1, 3, undefined],
      [1, 3, undefined],
    ]);
  });

  test('a server total larger than what the last page delivers is not repeated', async () => {
    const { backend } = setup({
      encounters: [HH],
      override: (req) =>
        req.url.pathname.endsWith('/Encounter')
          ? {
              status: 200,
              body: {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 5,
                link: [{ relation: 'self', url: req.url.href }],
                entry: [{ resource: HH, search: { mode: 'match' } }],
              },
            }
          : undefined,
    });
    const r = await backend.getPatientHistory({ patientId: 'p1' }, CTX);
    expect(r).toMatchObject({ total: 1, hasMore: false });
    expect(r.totalIsLowerBound).toBeUndefined();
  });

  test('a period ending in a bare December runs to the end of the year', async () => {
    const dec = encounter('z1', 'p1', '', '', { period: { start: '2026-12-31T22:00:00-05:00', end: '2026-12' } });
    for (const [when, want] of [['2026-12-31T23:30:00-05:00', true], ['2027-01-01T00:30:00-05:00', false]] as const) {
      const s = setup({ encounters: [dec], observations: [heartRate('h9', 'p1', when)], ignore: ['Observation.date'] });
      expect((await s.backend.getPatientHistory({ patientId: 'p1' }, CTX)).visits[0].hasVitals).toBe(want);
    }
  });
});
