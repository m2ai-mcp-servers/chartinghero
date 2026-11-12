/**
 * Backend seam. patient-service validates input and delegates here; each backend
 * (mock today, FHIR from PR6) implements the same four operations.
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
export type ResolvedPatient = Patient;

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
  searchPatients(p: PatientSearchParams, ctx: RequestContext): Promise<PatientSearchResponse>;
  getPatient(ref: PatientRef, ctx: RequestContext): Promise<ResolvedPatient>;
  getPatientHistory(p: PatientHistoryParams, ctx: RequestContext): Promise<PatientHistoryResponse>;
  createVisitNote(p: ValidatedVisitNote, ctx: WriteContext): Promise<CreateVisitNoteResponse>;
}
