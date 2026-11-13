import { describe, test, expect } from '@jest/globals';

import { MockBackend } from '../../src/backends/mock-backend.js';
import { backendContract } from './backend.contract.js';

backendContract('mock', () => new MockBackend(), {
  known: { identifier: 'PT-10001', firstName: 'Eleanor', lastName: 'Thompson', dateOfBirth: '1942-03-15', phone: '555-0101' },
  visits: [
    { date: '2024-12-20', type: 'skilled_nursing' },
    { date: '2024-12-17', type: 'skilled_nursing' },
  ],
  typeFilter: { type: 'physical_therapy', dates: [] },
  sharedNameQuery: 'Thompson',
  notActive: { query: 'Anderson', status: 'discharged', identifier: 'PT-10005' },
  unknownIdentifier: 'PT-00000',
});

const CTX = { requestId: 'mock', timezone: 'America/New_York' };

// How the mock happens to match text. A real EMR does not behave this way, so these are
// not part of the contract.
describe('mock-only matching', () => {
  test("an id search matches on a substring ('PT-' finds every patient)", async () => {
    const r = await new MockBackend().searchPatients({ query: 'PT-', searchType: 'id', limit: 2 }, CTX);
    expect(r.limit).toBe(2);
    expect(r.results).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.hasMore).toBe(true);
  });

  test('a phone search matches on any run of digits', async () => {
    const r = await new MockBackend().searchPatients({ query: '0101', searchType: 'phone' }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['PT-10001']);
  });

  test('the legacy offset still pages', async () => {
    const r = await new MockBackend().searchPatients({ query: 'PT-', searchType: 'id', limit: 2, offset: 4 }, CTX);
    expect(r.results.map((p) => p.id)).toEqual(['PT-10005']);
    expect(r.hasMore).toBe(false);
  });
});

describe('mock cursors belong to one request', () => {
  const refusal = 'cursor belongs to a different request';

  test('a search cursor is refused for another query, search type or status', async () => {
    const mock = new MockBackend();
    const first = await mock.searchPatients({ query: 'PT-', searchType: 'id', limit: 2 }, CTX);
    const cursor = first.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    const again = await mock.searchPatients({ query: 'PT-', searchType: 'id', limit: 2, cursor }, CTX);
    expect(again.results.map((p) => p.id)).not.toContain(first.results[0].id);
    for (const other of [
      { query: 'Thompson', searchType: 'id' },
      { query: 'PT-', searchType: 'all' },
      { query: 'PT-', searchType: 'id', status: 'active' },
    ] as const) {
      await expect(mock.searchPatients({ ...other, cursor }, CTX)).rejects.toThrow(refusal);
    }
  });

  test('a history cursor is refused for another patient or other filters', async () => {
    const mock = new MockBackend();
    const first = await mock.getPatientHistory({ patientId: 'PT-10001', limit: 1 }, CTX);
    const cursor = first.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    expect((await mock.getPatientHistory({ patientId: 'PT-10001', limit: 1, cursor }, CTX)).visits).toHaveLength(1);
    await expect(mock.getPatientHistory({ patientId: 'PT-10002', cursor }, CTX)).rejects.toThrow(refusal);
    await expect(mock.getPatientHistory({ patientId: 'PT-10001', startDate: '2024-01-01', cursor }, CTX)).rejects.toThrow(refusal);
    await expect(mock.getPatientHistory({ patientId: 'PT-10001', visitType: 'skilled_nursing', cursor }, CTX)).rejects.toThrow(refusal);
  });
});
