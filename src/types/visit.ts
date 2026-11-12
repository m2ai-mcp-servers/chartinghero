/**
 * Visit and clinical note type definitions
 *
 * Based on typical home health visit documentation patterns.
 * These types will be refined once a real EMR backend is available.
 */

/**
 * Vital signs recorded during a visit
 */
export interface VitalSigns {
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  temperature?: number;
  temperatureUnit?: 'F' | 'C';
  oxygenSaturation?: number;
  weight?: number;
  weightUnit?: 'lbs' | 'kg';
  painLevel?: number;  // 0-10 scale
}

/**
 * Visit type enumeration
 */
export type VisitType =
  | 'skilled_nursing'
  | 'physical_therapy'
  | 'occupational_therapy'
  | 'speech_therapy'
  | 'home_health_aide'
  | 'social_work'
  | 'initial_assessment'
  | 'recertification'
  | 'discharge'
  | 'other';

/**
 * Visit status
 */
export type VisitStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'cancelled'
  | 'pending_review';

/**
 * Visit note creation parameters
 */
export interface CreateVisitNoteParams {
  patientId: string;
  visitType: VisitType;
  visitDate: string;          // ISO 8601 date
  timeIn: string;             // HH:MM format
  timeOut: string;            // HH:MM format
  vitalSigns?: VitalSigns;
  subjective?: string;        // Patient's reported symptoms/concerns
  objective?: string;         // Nurse's observations
  assessment?: string;        // Clinical assessment
  plan?: string;              // Care plan/next steps
  interventions?: string[];   // Interventions performed
  patientResponse?: string;   // How patient responded to care
  education?: string[];       // Patient education provided
  nextVisitDate?: string;     // Scheduled next visit
  notes?: string;             // Additional notes
}

/**
 * Visit note record (as stored in EMR)
 */
export interface VisitNote {
  id: string;
  patientId: string;
  visitType: VisitType;
  status: VisitStatus;
  visitDate: string;
  timeIn: string;
  timeOut: string;
  duration: number;           // Minutes
  vitalSigns?: VitalSigns;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  interventions?: string[];
  patientResponse?: string;
  education?: string[];
  notes?: string;
  nextVisitDate?: string;
  nurseId: string;
  nurseName: string;
  signedAt?: string;
  signedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Visit note summary (for history listings)
 */
export interface VisitNoteSummary {
  id: string;
  visitDate: string;
  visitType: VisitType;
  status: VisitStatus;
  duration: number;
  nurseName: string;
  primaryDiagnosis?: string;
  hasVitals: boolean;
}

/**
 * Patient history request parameters
 */
export interface PatientHistoryParams {
  patientId: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  visitType?: VisitType;
}

/**
 * Patient history response
 */
export interface PatientHistoryResponse {
  patientId: string;
  patientName: string;
  visits: VisitNoteSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Visit note creation response
 */
export interface CreateVisitNoteResponse {
  success: boolean;
  visitNoteId: string;
  message: string;
  visitNote?: VisitNote;
}
