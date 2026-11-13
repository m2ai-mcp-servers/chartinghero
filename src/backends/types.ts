/**
 * Backend seam. patient-service validates input and delegates here; each backend
 * (mock or FHIR) implements the same four operations.
 */

import type {
  Patient,
  PatientSearchParams,
  PatientSearchResponse,
  PatientHistoryParams,
  PatientHistoryResponse,
  CreateVisitNoteParams,
  CreateVisitNoteResponse,
} from '../types/index.js';

export type PatientRef = { serverId: string } | { identifier: string };

/** A patient as returned by a backend. The FHIR backend fills it from Patient resources. */
export interface ResolvedPatient extends Patient {
  /** What a later `subject` points at (plan 3.1). */
  reference: `Patient/${string}`;
}

/** Visit note input that has passed patient-service validation. */
export type ValidatedVisitNote = CreateVisitNoteParams;

export interface RequestContext {
  requestId: string;
  timezone: string;
}

export interface WriteContext extends RequestContext {
  practitioner: {
    reference: `Practitioner/${string}`;
    display: string;
    source: 'configured-sandbox' | 'smart-fhirUser';
  };
  idempotencyKey: string;
  dryRun: boolean;
}

export interface PatientBackend {
  readonly kind: 'mock' | 'fhir';
  /** Startup probe. A rejection aborts startup. */
  init?(): Promise<void>;
  searchPatients(p: PatientSearchParams, ctx: RequestContext): Promise<PatientSearchResponse>;
  getPatient(ref: PatientRef, ctx: RequestContext): Promise<ResolvedPatient>;
  getPatientHistory(p: PatientHistoryParams, ctx: RequestContext): Promise<PatientHistoryResponse>;
  createVisitNote(p: ValidatedVisitNote, ctx: WriteContext): Promise<CreateVisitNoteResponse>;
}
