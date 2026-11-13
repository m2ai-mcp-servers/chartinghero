/**
 * Patient Service Unit Tests
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  searchPatients,
  getPatient,
  getPatientHistory,
  createVisitNote,
  configurePatientService,
  resetPatientService,
} from '../src/services/patient-service.js';
import { resetConfig } from '../src/config.js';
import { MockBackend } from '../src/backends/mock-backend.js';
import type { PatientBackend } from '../src/backends/types.js';
import type { CreateVisitNoteParams, VisitNote } from '../src/types/index.js';
import { ValidationError, NotFoundError } from '../src/utils/errors.js';

const ENV_KEYS = ['BACKEND', 'DASHBOARD_SYNC', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'FHIR_BASE_URL',
  'FHIR_ENVIRONMENT', 'FHIR_PRACTITIONER_ID', 'VISIT_TIMEZONE'];
const savedEnv: Record<string, string | undefined> = {};

const backend = new MockBackend();

// Fresh config, fresh mock data and an injected backend for every test.
beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  resetConfig();
  resetPatientService();
  backend.reset();
  configurePatientService({ backend });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetConfig();
  resetPatientService();
});

const NOTE: CreateVisitNoteParams = {
  patientId: 'PT-10001',
  visitType: 'skilled_nursing',
  visitDate: '2024-12-22',
  timeIn: '10:00',
  timeOut: '10:45',
};

describe('searchPatients', () => {
  test('should find patient by name', async () => {
    const result = await searchPatients({ query: 'Eleanor' });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].firstName).toBe('Eleanor');
  });

  test('should find patient by ID', async () => {
    const result = await searchPatients({ query: 'PT-10001', searchType: 'id' });

    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe('PT-10001');
  });

  test('should find patient by phone', async () => {
    const result = await searchPatients({ query: '5550101', searchType: 'phone' });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].phone).toContain('555-0101');
  });

  test('should filter by status', async () => {
    const result = await searchPatients({ query: 'Thompson', status: 'active' });

    result.results.forEach((patient) => {
      expect(patient.status).toBe('active');
    });
  });

  test('should throw ValidationError for empty query', async () => {
    await expect(searchPatients({ query: '' })).rejects.toThrow(ValidationError);
  });

  test('should return empty results for no match', async () => {
    const result = await searchPatients({ query: 'NonexistentPatient12345' });

    expect(result.results.length).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe('getPatient', () => {
  test('should return patient by ID', async () => {
    const patient = await getPatient('PT-10001');

    expect(patient.id.id).toBe('PT-10001');
    expect(patient.demographics.firstName).toBe('Eleanor');
    expect(patient.demographics.lastName).toBe('Thompson');
  });

  test('should throw NotFoundError for invalid ID', async () => {
    await expect(getPatient('PT-99999')).rejects.toThrow(NotFoundError);
  });

  test('should throw ValidationError for empty ID', async () => {
    await expect(getPatient('')).rejects.toThrow(ValidationError);
  });
});

describe('getPatientHistory', () => {
  test('should return visit history for patient', async () => {
    const result = await getPatientHistory({ patientId: 'PT-10001' });

    expect(result.patientId).toBe('PT-10001');
    expect(result.patientName).toBe('Eleanor Thompson');
    expect(result.visits.length).toBeGreaterThan(0);
  });

  test('should respect limit parameter', async () => {
    const result = await getPatientHistory({ patientId: 'PT-10001', limit: 1 });

    expect(result.visits.length).toBeLessThanOrEqual(1);
  });

  test('should throw NotFoundError for invalid patient', async () => {
    await expect(getPatientHistory({ patientId: 'PT-99999' })).rejects.toThrow(NotFoundError);
  });

  test('should throw ValidationError for empty patient ID', async () => {
    await expect(getPatientHistory({ patientId: '' })).rejects.toThrow(ValidationError);
  });

  test('should return visits in descending date order', async () => {
    const result = await getPatientHistory({ patientId: 'PT-10001' });

    for (let i = 1; i < result.visits.length; i++) {
      expect(result.visits[i - 1].visitDate >= result.visits[i].visitDate).toBe(true);
    }
  });
});

describe('createVisitNote', () => {
  test('should create visit note with required fields', async () => {
    const result = await createVisitNote({
      patientId: 'PT-10001',
      visitType: 'skilled_nursing',
      visitDate: '2024-12-22',
      timeIn: '10:00',
      timeOut: '10:45',
    });

    expect(result.success).toBe(true);
    expect(result.visitNoteId).toBeDefined();
    expect(result.visitNote?.patientId).toBe('PT-10001');
    expect(result.visitNote?.duration).toBe(45);
  });

  test('should create visit note with vital signs', async () => {
    const result = await createVisitNote({
      patientId: 'PT-10001',
      visitType: 'skilled_nursing',
      visitDate: '2024-12-22',
      timeIn: '14:00',
      timeOut: '14:30',
      vitalSigns: {
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        heartRate: 72,
      },
    });

    expect(result.success).toBe(true);
    expect(result.visitNote?.vitalSigns?.bloodPressureSystolic).toBe(120);
    expect(result.visitNote?.vitalSigns?.bloodPressureDiastolic).toBe(80);
  });

  test('should throw NotFoundError for invalid patient', async () => {
    await expect(
      createVisitNote({
        patientId: 'PT-99999',
        visitType: 'skilled_nursing',
        visitDate: '2024-12-22',
        timeIn: '10:00',
        timeOut: '10:45',
      })
    ).rejects.toThrow(NotFoundError);
  });

  test('should throw ValidationError for missing required fields', async () => {
    await expect(
      createVisitNote({
        patientId: 'PT-10001',
        visitType: 'skilled_nursing',
        visitDate: '',
        timeIn: '10:00',
        timeOut: '10:45',
      })
    ).rejects.toThrow(ValidationError);
  });

  test('should calculate duration correctly', async () => {
    const result = await createVisitNote({
      patientId: 'PT-10001',
      visitType: 'skilled_nursing',
      visitDate: '2024-12-22',
      timeIn: '09:15',
      timeOut: '10:00',
    });

    expect(result.visitNote?.duration).toBe(45);
  });
});

describe('mock hardening', () => {
  test('notes are pending_review, unsigned, attributed to the fictional practitioner', async () => {
    const result = await createVisitNote(NOTE);

    expect(result.visitNote?.status).toBe('pending_review');
    expect(result.visitNote?.signedAt).toBeUndefined();
    expect(result.visitNote?.signedBy).toBeUndefined();
    expect(result.visitNote?.nurseId).toBe('mock-rn-1');
    expect(result.visitNote?.nurseName).toBe('Avery Quinn, RN');
  });

  test('ids stay distinct across a simulated restart and never reuse seeded dashboard ids', async () => {
    const first = await createVisitNote(NOTE);
    backend.reset(); // restart: in-memory state is gone
    const second = await createVisitNote(NOTE);

    expect(first.visitNoteId).not.toBe(second.visitNoteId);
    for (const id of [first.visitNoteId, second.visitNoteId]) {
      expect(id).not.toMatch(/^VN-3000[0-2]$/);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test('reset() discards notes created earlier', async () => {
    const before = (await getPatientHistory({ patientId: 'PT-10001', limit: 50 })).total;
    await createVisitNote(NOTE);
    expect((await getPatientHistory({ patientId: 'PT-10001', limit: 50 })).total).toBe(before + 1);
    backend.reset();
    expect((await getPatientHistory({ patientId: 'PT-10001', limit: 50 })).total).toBe(before);
  });

  test('a name query no longer matches every patient through an empty phone-digit match', async () => {
    const result = await searchPatients({ query: 'Eleanor' });
    expect(result.results.every((p) => p.firstName === 'Eleanor')).toBe(true);
  });
});

describe('dashboard projection gate', () => {
  function syncSpy() {
    return jest.fn<(v: VisitNote) => Promise<boolean>>().mockResolvedValue(true);
  }

  test('SUPABASE_* set but DASHBOARD_SYNC unset: no sync call', async () => {
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_ANON_KEY = 'test-key';
    const sync = syncSpy();
    configurePatientService({ sync });

    const result = await createVisitNote(NOTE);

    expect(sync).toHaveBeenCalledTimes(0);
    expect(result.message).not.toContain('synced');
  });

  test('BACKEND=fhir (stub) with DASHBOARD_SYNC=on: no sync call', async () => {
    Object.assign(process.env, {
      BACKEND: 'fhir', DASHBOARD_SYNC: 'on',
      SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'test-key',
      FHIR_BASE_URL: 'http://127.0.0.1:8080/fhir', FHIR_ENVIRONMENT: 'local',
      FHIR_PRACTITIONER_ID: 'p1', VISIT_TIMEZONE: 'America/New_York',
    });
    const mock = new MockBackend();
    const stub: PatientBackend = {
      kind: 'fhir',
      searchPatients: (p, c) => mock.searchPatients(p, c),
      getPatient: (r, c) => mock.getPatient(r, c),
      getPatientHistory: (p, c) => mock.getPatientHistory(p, c),
      createVisitNote: (p, c) => mock.createVisitNote(p, c),
    };
    const sync = syncSpy();
    configurePatientService({ backend: stub, sync });

    const result = await createVisitNote(NOTE);

    expect(result.success).toBe(true);
    expect(sync).toHaveBeenCalledTimes(0);
  });

  test('BACKEND=mock with DASHBOARD_SYNC=on: syncs once and reports it', async () => {
    Object.assign(process.env, { BACKEND: 'mock', DASHBOARD_SYNC: 'on' });
    const sync = syncSpy();
    configurePatientService({ sync });

    const result = await createVisitNote(NOTE);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('(synced to dashboard)');
  });

  test('a sync that throws after the write still returns the created note', async () => {
    Object.assign(process.env, { BACKEND: 'mock', DASHBOARD_SYNC: 'on' });
    configurePatientService({
      sync: jest.fn<(v: VisitNote) => Promise<boolean>>().mockRejectedValue(new Error('Invalid supabaseUrl')),
    });

    const result = await createVisitNote(NOTE);

    expect(result.success).toBe(true);
    expect(result.message).toContain('(dashboard sync failed)');
  });

  test('a failed sync is reported as failed, not as synced', async () => {
    Object.assign(process.env, { BACKEND: 'mock', DASHBOARD_SYNC: 'on' });
    configurePatientService({ sync: jest.fn<(v: VisitNote) => Promise<boolean>>().mockResolvedValue(false) });

    const result = await createVisitNote(NOTE);

    expect(result.message).toContain('(dashboard sync failed)');
    expect(result.message).not.toContain('(synced to dashboard)');
  });
});
