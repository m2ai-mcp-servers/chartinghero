/**
 * Domain to tool-output DTO mappers, shared by every backend.
 */

import type {
  Patient,
  PatientSearchResult,
  VisitNote,
  VisitNoteSummary,
} from '../types/index.js';

export function toSearchResult(patient: Patient): PatientSearchResult {
  return {
    id: patient.id.id,
    firstName: patient.demographics.firstName,
    lastName: patient.demographics.lastName,
    dateOfBirth: patient.demographics.dateOfBirth,
    phone: patient.contact.phone,
    status: patient.status,
    primaryDiagnosis: patient.diagnosis?.[0],
  };
}

export function toVisitSummary(visit: VisitNote): VisitNoteSummary {
  return {
    id: visit.id,
    visitDate: visit.visitDate,
    visitType: visit.visitType,
    status: visit.status,
    duration: visit.duration,
    nurseName: visit.nurseName,
    hasVitals: visit.vitalSigns !== undefined,
  };
}
