/**
 * FHIR R4 backend. PR6 implements the read path and the write gates; the transaction
 * write itself lands in PR7, so createVisitNote always ends in NotImplementedError here.
 */

import type { CapabilityStatement } from 'fhir/r4.js';

import { bearerAuth } from '../../auth/bearer.js';
import { noAuth } from '../../auth/none.js';
import type { FhirConfig } from '../../config.js';
import { fromFhirPatient } from '../../fhir/patient.js';
import { ApiError, NotFoundError, NotImplementedError, UnsupportedServerError, WriteRefusedError } from '../../utils/errors.js';
import type {
  CreateVisitNoteResponse,
  PatientHistoryParams,
  PatientHistoryResponse,
  PatientSearchParams,
  PatientSearchResponse,
} from '../../types/index.js';
import type { PatientBackend, PatientRef, RequestContext, ResolvedPatient, ValidatedVisitNote, WriteContext } from '../types.js';
import { parseCapabilities } from './capabilities.js';
import type { ServerCapabilities } from './capabilities.js';
import { FhirClient } from './client.js';
import { preflightVisit } from './preflight.js';
import { findByIdentifier, getPatientHistory, readPatient, resolvePatient, searchPatients } from './read.js';
import type { ReadDeps } from './read.js';

export interface FhirBackendOptions {
  config: FhirConfig;
  timeoutMs: number;
  /** Test seam: a stub or recorded fetch. */
  fetch?: typeof fetch;
}

export class FhirBackend implements PatientBackend {
  readonly kind = 'fhir' as const;
  private readonly config: FhirConfig;
  private readonly client: FhirClient;
  private caps: Promise<ServerCapabilities> | undefined;

  constructor(opts: FhirBackendOptions) {
    this.config = opts.config;
    this.client = new FhirClient({
      baseUrl: opts.config.baseUrl,
      auth: opts.config.bearerToken ? bearerAuth(opts.config.bearerToken) : noAuth,
      timeoutMs: opts.timeoutMs,
      fetch: opts.fetch,
    });
  }

  /** Probe /metadata. Called at startup so a wrong or unreachable server aborts there. */
  async init(): Promise<void> {
    await this.capabilities();
  }

  /** /metadata is read once per process; a failed probe is retried on the next call. */
  private capabilities(): Promise<ServerCapabilities> {
    if (!this.caps) {
      this.caps = this.client
        .metadata()
        .then((cs) => parseCapabilities(cs as CapabilityStatement))
        .catch((error) => {
          this.caps = undefined;
          if (error instanceof ApiError) {
            const detail = [error.httpStatus !== undefined ? `HTTP ${error.httpStatus}` : '', ...error.issueCodes]
              .filter(Boolean)
              .join(', ');
            throw new UnsupportedServerError(`cannot read FHIR /metadata${detail ? ` (${detail})` : ''}`);
          }
          throw error;
        });
    }
    return this.caps;
  }

  private async deps(): Promise<ReadDeps> {
    return { client: this.client, caps: await this.capabilities(), identifierSystem: this.config.identifierSystem };
  }

  async searchPatients(params: PatientSearchParams, _ctx: RequestContext): Promise<PatientSearchResponse> {
    return searchPatients(await this.deps(), params);
  }

  async getPatient(ref: PatientRef, _ctx: RequestContext): Promise<ResolvedPatient> {
    const deps = await this.deps();
    const patient = 'serverId' in ref ? await readPatient(deps, ref.serverId) : await findByIdentifier(deps, ref.identifier);
    if (!patient) throw new NotFoundError('Patient');
    return { ...fromFhirPatient(patient, this.config.identifierSystem), reference: `Patient/${patient.id}` };
  }

  async getPatientHistory(params: PatientHistoryParams, ctx: RequestContext): Promise<PatientHistoryResponse> {
    return getPatientHistory(await this.deps(), params, ctx.timezone);
  }

  async createVisitNote(params: ValidatedVisitNote, ctx: WriteContext): Promise<CreateVisitNoteResponse> {
    // Plan 3.2: with FHIR_WRITE off, fail before any HTTP call.
    if (!this.config.write) {
      throw new WriteRefusedError('FHIR_WRITE is off; this server is read-only until it is set to on');
    }
    const deps = await this.deps();
    // Plan 3.3: resolve the patient first, then prove the visit is not already charted.
    await resolvePatient(deps, params.patientId);
    // The duplicate check is an Encounter search, and a note-only write has no Encounter.
    // Until a note has its own check (PR7), refuse rather than write unchecked.
    if (this.config.writeProfile !== 'full' || deps.caps.writeProfile !== 'full') {
      throw new WriteRefusedError('note-only write has no duplicate check in this build; refusing write');
    }
    await preflightVisit(deps, ctx.idempotencyKey);
    throw new NotImplementedError('FHIR write is not in this build yet; search and history work');
  }
}
