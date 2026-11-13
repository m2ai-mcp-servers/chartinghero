/**
 * Tool output for paged results: what the model is told when a page is empty but more
 * pages exist, and when a total is only a lower bound. The backend is a stub.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

import { MockBackend } from '../src/backends/mock-backend.js';
import type { PatientBackend } from '../src/backends/types.js';
import { resetConfig } from '../src/config.js';
import { configurePatientService, resetPatientService } from '../src/services/patient-service.js';
import { executeGetPatientHistory } from '../src/tools/get-patient-history.js';
import { executeSearchPatient } from '../src/tools/search-patient.js';
import type { PatientHistoryResponse, PatientSearchResponse } from '../src/types/index.js';

const mock = new MockBackend();
const savedBackend = process.env.BACKEND;

function stub(search: Partial<PatientSearchResponse>, history: Partial<PatientHistoryResponse>): void {
  const backend: PatientBackend = {
    kind: 'mock',
    searchPatients: async () => ({ results: [], total: 0, limit: 1, offset: 0, hasMore: false, ...search }),
    getPatient: (r, c) => mock.getPatient(r, c),
    getPatientHistory: async () => ({
      patientId: 'PT-10001', patientName: 'Eleanor Thompson', visits: [], total: 0, limit: 1, offset: 0, hasMore: false, ...history,
    }),
    createVisitNote: (p, c) => mock.createVisitNote(p, c),
  };
  configurePatientService({ backend });
}

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n');

beforeEach(() => {
  process.env.BACKEND = 'mock';
  resetConfig();
  resetPatientService();
});
afterEach(() => {
  if (savedBackend === undefined) delete process.env.BACKEND;
  else process.env.BACKEND = savedBackend;
  resetConfig();
  resetPatientService();
});

const PATIENT = { id: 'PT-10001', firstName: 'Eleanor', lastName: 'Thompson', dateOfBirth: '1942-03-15', status: 'active' as const };
const VISIT = {
  id: 'v1', visitDate: '', visitType: 'skilled_nursing' as const, status: 'completed' as const, duration: 30, nurseName: 'Avery Quinn, RN', hasVitals: false,
};

describe('search_patient output', () => {
  test('an empty page with more pages points at the cursor instead of saying nothing matched', async () => {
    stub({ hasMore: true, nextCursor: 'abc.def', totalIsLowerBound: true }, {});
    const out = text(await executeSearchPatient({ query: 'Thompson', limit: 1 }));
    expect(out).toContain('more pages exist');
    expect(out).toContain('cursor "abc.def"');
    expect(out).not.toContain('No patients found');
  });

  test('an empty last page says nothing matched', async () => {
    stub({}, {});
    expect(text(await executeSearchPatient({ query: 'Thompson' }))).toContain('No patients found matching "Thompson"');
  });

  test('a lower-bound total is shown with a plus', async () => {
    stub({ results: [PATIENT], total: 1, hasMore: true, nextCursor: 'abc.def', totalIsLowerBound: true }, {});
    const out = text(await executeSearchPatient({ query: 'Thompson', limit: 1 }));
    expect(out).toContain('Found 1+ patient(s)');
    expect(out).toContain('Showing 1 of 1+ results');
  });
});

describe('get_patient_history output', () => {
  test('an empty page with more pages points at the cursor', async () => {
    stub({}, { hasMore: true, nextCursor: 'abc.def', totalIsLowerBound: true });
    const out = text(await executeGetPatientHistory({ patientId: 'PT-10001', limit: 1 }));
    expect(out).toContain('more pages exist');
    expect(out).toContain('cursor "abc.def"');
    expect(out).not.toContain('No visits found');
  });

  test('a lower-bound total has a plus, and a visit with no date says so', async () => {
    stub({}, { visits: [VISIT], total: 1, hasMore: true, nextCursor: 'abc.def', totalIsLowerBound: true });
    const out = text(await executeGetPatientHistory({ patientId: 'PT-10001', limit: 1 }));
    expect(out).toContain('Showing 1 of 1+ visit(s)');
    expect(out).toContain('**date not recorded**');
  });
});

describe('get_patient_history output (second review)', () => {
  test('an empty last page of a paged history says the history has ended', async () => {
    stub({}, {});
    const out = text(await executeGetPatientHistory({ patientId: 'PT-10001', cursor: 'abc.def' }));
    expect(out).toContain('end of the history');
    expect(out).not.toContain('No visits found');
  });
});
