/**
 * In-memory mock backend over fictional seed data.
 *
 * Each instance owns a copy of the seed, so tests and restarts never share state.
 * Visit ids are UUIDs: a counter would collide with the demo dashboard's seeded rows.
 */

import { randomUUID } from 'node:crypto';

import { NotFoundError } from '../utils/errors.js';
import { mockPatients, mockVisitNotes } from '../services/mock-data.js';
import { toSearchResult, toVisitSummary } from '../mappers/dto.js';
import type {
  PatientBackend,
  PatientRef,
  RequestContext,
  ResolvedPatient,
  ValidatedVisitNote,
  WriteContext,
} from './types.js';
import type {
  Patient,
  PatientSearchParams,
  PatientSearchResponse,
  PatientHistoryParams,
  PatientHistoryResponse,
  CreateVisitNoteResponse,
  VisitNote,
} from '../types/index.js';

/** Fixed fictional nurse used for every mock write. */
export const MOCK_PRACTITIONER: WriteContext['practitioner'] = {
  reference: 'Practitioner/mock-rn-1',
  display: 'Avery Quinn, RN',
  source: 'configured-sandbox',
};

export class MockBackend implements PatientBackend {
  readonly kind = 'mock' as const;
  private patients: Patient[] = [];
  private visits: VisitNote[] = [];

  constructor() {
    this.reset();
  }

  /** Restore the fictional seed data. */
  reset(): void {
    this.patients = structuredClone(mockPatients);
    this.visits = structuredClone(mockVisitNotes);
  }

  private findPatient(id: string): Patient {
    const patient = this.patients.find((p) => p.id.id === id);
    if (!patient) throw new NotFoundError('Patient');
    return patient;
  }

  async searchPatients(params: PatientSearchParams, _ctx: RequestContext): Promise<PatientSearchResponse> {
    const query = params.query.toLowerCase().trim();
    const searchType = params.searchType || 'all';
    const limit = params.limit || 10;
    const offset = params.offset || 0;
    const queryDigits = query.replace(/\D/g, '');

    const filtered = this.patients.filter((patient) => {
      if (params.status && patient.status !== params.status) return false;

      const fullName = `${patient.demographics.firstName} ${patient.demographics.lastName}`.toLowerCase();
      const id = patient.id.id.toLowerCase();
      const phone = (patient.contact.phone || '').replace(/\D/g, '');

      switch (searchType) {
        case 'name':
          return fullName.includes(query);
        case 'id':
          return id.includes(query);
        case 'phone':
          return queryDigits.length > 0 && phone.includes(queryDigits);
        case 'all':
        default:
          return (
            fullName.includes(query) ||
            id.includes(query) ||
            (queryDigits.length > 0 && phone.includes(queryDigits))
          );
      }
    });

    const results = filtered.slice(offset, offset + limit).map(toSearchResult);
    return {
      results,
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + results.length < filtered.length,
    };
  }

  async getPatient(ref: PatientRef, _ctx: RequestContext): Promise<ResolvedPatient> {
    // Mock patients have a single id that serves as both server id and identifier.
    return this.findPatient('serverId' in ref ? ref.serverId : ref.identifier);
  }

  async getPatientHistory(params: PatientHistoryParams, _ctx: RequestContext): Promise<PatientHistoryResponse> {
    const patient = this.findPatient(params.patientId);
    const limit = params.limit || 10;
    const offset = params.offset || 0;

    const visits = this.visits
      .filter((v) => v.patientId === params.patientId)
      .filter((v) => !params.startDate || v.visitDate >= params.startDate)
      .filter((v) => !params.endDate || v.visitDate <= params.endDate)
      .filter((v) => !params.visitType || v.visitType === params.visitType)
      .sort((a, b) => b.visitDate.localeCompare(a.visitDate));

    const page = visits.slice(offset, offset + limit);
    return {
      patientId: params.patientId,
      patientName: `${patient.demographics.firstName} ${patient.demographics.lastName}`,
      visits: page.map(toVisitSummary),
      total: visits.length,
      limit,
      offset,
      hasMore: offset + page.length < visits.length,
    };
  }

  async createVisitNote(params: ValidatedVisitNote, ctx: WriteContext): Promise<CreateVisitNoteResponse> {
    this.findPatient(params.patientId);

    const [inHour, inMin] = params.timeIn.split(':').map(Number);
    const [outHour, outMin] = params.timeOut.split(':').map(Number);
    const duration = outHour * 60 + outMin - (inHour * 60 + inMin);
    const now = new Date().toISOString();

    // Unsigned: a nurse reviews and signs in the EMR. No auto-sign.
    const visitNote: VisitNote = {
      id: randomUUID(),
      patientId: params.patientId,
      visitType: params.visitType,
      status: 'pending_review',
      visitDate: params.visitDate,
      timeIn: params.timeIn,
      timeOut: params.timeOut,
      duration: duration > 0 ? duration : 0,
      vitalSigns: params.vitalSigns,
      subjective: params.subjective,
      objective: params.objective,
      assessment: params.assessment,
      plan: params.plan,
      interventions: params.interventions,
      patientResponse: params.patientResponse,
      education: params.education,
      notes: params.notes,
      nextVisitDate: params.nextVisitDate,
      nurseId: ctx.practitioner.reference.slice('Practitioner/'.length),
      nurseName: ctx.practitioner.display,
      createdAt: now,
      updatedAt: now,
    };

    this.visits.push(visitNote);

    return {
      success: true,
      visitNoteId: visitNote.id,
      message: `Visit note ${visitNote.id} created for patient ${params.patientId} (pending review)`,
      visitNote,
    };
  }
}
