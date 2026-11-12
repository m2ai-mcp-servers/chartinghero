/**
 * Patient Service: input validation, delegation to the configured backend,
 * and the post-write dashboard projection hook.
 */

import { createHash, randomUUID } from 'node:crypto';

import { getConfig } from '../config.js';
import type { ChartingHeroConfig } from '../config.js';
import { hashId, logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { createBackend } from '../backends/factory.js';
import { MOCK_PRACTITIONER } from '../backends/mock-backend.js';
import type { PatientBackend, RequestContext, WriteContext } from '../backends/types.js';
import { syncVisitToSupabase } from './supabase-service.js';
import type {
  Patient,
  PatientSearchParams,
  PatientSearchResponse,
  PatientHistoryParams,
  PatientHistoryResponse,
  CreateVisitNoteParams,
  CreateVisitNoteResponse,
  VisitNote,
} from '../types/index.js';

type SyncFn = (visit: VisitNote) => Promise<boolean>;

let backendInstance: PatientBackend | null = null;
let syncFn: SyncFn = syncVisitToSupabase;

/** The active backend, created from config on first use. */
export function getBackend(): PatientBackend {
  if (!backendInstance) backendInstance = createBackend(getConfig());
  return backendInstance;
}

/** Test seam: inject a backend and/or the dashboard sync function. */
export function configurePatientService(deps: { backend?: PatientBackend; sync?: SyncFn }): void {
  if (deps.backend) backendInstance = deps.backend;
  if (deps.sync) syncFn = deps.sync;
}

export function resetPatientService(): void {
  backendInstance = null;
  syncFn = syncVisitToSupabase;
}

function requestContext(config: ChartingHeroConfig): RequestContext {
  return { requestId: randomUUID(), timezone: config.visitTimezone ?? 'UTC' };
}

function practitionerFor(config: ChartingHeroConfig, backend: PatientBackend): WriteContext['practitioner'] {
  if (backend.kind === 'mock' || !config.fhir) return MOCK_PRACTITIONER;
  // The display name is resolved from Practitioner.name in PR7.
  return {
    reference: `Practitioner/${config.fhir.practitionerId}`,
    display: `Practitioner/${config.fhir.practitionerId}`,
    source: 'configured-sandbox',
  };
}

function requireText(value: string | undefined, message: string, field: string): void {
  if (!value || value.trim().length === 0) throw new ValidationError(message, field);
}

/**
 * The dashboard projection runs only when DASHBOARD_SYNC=on and the write went to the
 * mock backend. SUPABASE_* alone no longer syncs. FHIR projection waits for the PR8 guard.
 */
export function shouldProject(config: ChartingHeroConfig, backend: PatientBackend): boolean {
  return config.dashboardSync && config.backend === 'mock' && backend.kind === 'mock';
}

export async function searchPatients(params: PatientSearchParams): Promise<PatientSearchResponse> {
  const config = getConfig();
  const startTime = Date.now();
  logger.info('Searching patients', { tool: 'search_patient' });

  requireText(params.query, 'Search query is required', 'query');

  try {
    const response = await getBackend().searchPatients(params, requestContext(config));
    logger.audit('search_patient', true, Date.now() - startTime);
    return response;
  } catch (error) {
    logger.audit('search_patient', false, Date.now() - startTime);
    throw error;
  }
}

export async function getPatient(patientId: string): Promise<Patient> {
  const config = getConfig();
  const startTime = Date.now();
  logger.info('Getting patient');

  requireText(patientId, 'Patient ID is required', 'patientId');

  try {
    const patient = await getBackend().getPatient({ serverId: patientId }, requestContext(config));
    logger.audit('get_patient', true, Date.now() - startTime);
    return patient;
  } catch (error) {
    logger.audit('get_patient', false, Date.now() - startTime);
    throw error;
  }
}

export async function getPatientHistory(params: PatientHistoryParams): Promise<PatientHistoryResponse> {
  const config = getConfig();
  const startTime = Date.now();
  logger.info('Getting patient history', { tool: 'get_patient_history' });

  requireText(params.patientId, 'Patient ID is required', 'patientId');

  try {
    const response = await getBackend().getPatientHistory(params, requestContext(config));
    logger.audit('get_patient_history', true, Date.now() - startTime);
    return response;
  } catch (error) {
    logger.audit('get_patient_history', false, Date.now() - startTime);
    throw error;
  }
}

export async function createVisitNote(params: CreateVisitNoteParams): Promise<CreateVisitNoteResponse> {
  const config = getConfig();
  const startTime = Date.now();
  logger.info('Creating visit note', { tool: 'create_visit_note' });

  requireText(params.patientId, 'Patient ID is required', 'patientId');
  if (!params.visitType) throw new ValidationError('Visit type is required', 'visitType');
  requireText(params.visitDate, 'Visit date is required', 'visitDate');
  requireText(params.timeIn, 'Time in is required', 'timeIn');
  requireText(params.timeOut, 'Time out is required', 'timeOut');

  const backend = getBackend();
  const practitioner = practitionerFor(config, backend);
  const ctx: WriteContext = {
    ...requestContext(config),
    practitioner,
    idempotencyKey: createHash('sha256')
      .update([params.patientId, params.visitDate, params.timeIn, practitioner.reference].join('|'))
      .digest('hex'),
    dryRun: false,
  };

  let response: CreateVisitNoteResponse;
  try {
    response = await backend.createVisitNote(params, ctx);
  } catch (error) {
    logger.audit('create_visit_note', false, Date.now() - startTime);
    throw error;
  }

  // Post-write projection hook. The message reports what actually happened.
  if (response.success && response.visitNote && shouldProject(config, backend)) {
    // The note is already written, so a sync failure must never turn into a tool error.
    const synced = await syncFn(response.visitNote).catch(() => false);
    if (synced) {
      logger.info('Visit synced to dashboard', { visitIdHash: hashId(response.visitNoteId) });
      response.message += ' (synced to dashboard)';
    } else {
      logger.warn('Dashboard sync failed', { visitIdHash: hashId(response.visitNoteId) });
      response.message += ' (dashboard sync failed)';
    }
  }

  logger.audit('create_visit_note', response.success, Date.now() - startTime);
  return response;
}
