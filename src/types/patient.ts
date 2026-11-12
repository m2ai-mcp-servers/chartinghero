/**
 * Patient-related type definitions
 *
 * Based on typical EMR data structures. These types will be refined
 * once a real EMR backend is available.
 */

/**
 * Patient identifier - unique within the EMR system
 */
export interface PatientId {
  id: string;           // Internal EMR ID (e.g., "PT-12345")
  mrn?: string;         // Medical Record Number (if different)
  externalId?: string;  // External system ID
}

/**
 * Patient demographic information
 */
export interface PatientDemographics {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string;  // ISO 8601 date (YYYY-MM-DD)
  gender?: 'male' | 'female' | 'other' | 'unknown';
}

/**
 * Patient contact information
 */
export interface PatientContact {
  phone?: string;
  phoneType?: 'home' | 'mobile' | 'work';
  alternatePhone?: string;
  email?: string;
  address?: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  };
}

/**
 * Patient insurance information (summary only)
 */
export interface PatientInsurance {
  primaryPayer?: string;
  memberId?: string;
  groupNumber?: string;
}

/**
 * Patient care team assignment
 */
export interface PatientCareTeam {
  primaryNurse?: string;
  primaryPhysician?: string;
  caseManager?: string;
  agency?: string;
}

/**
 * Full patient record
 */
export interface Patient {
  id: PatientId;
  demographics: PatientDemographics;
  contact: PatientContact;
  insurance?: PatientInsurance;
  careTeam?: PatientCareTeam;
  status: 'active' | 'inactive' | 'discharged' | 'pending';
  admissionDate?: string;
  dischargeDate?: string;
  diagnosis?: string[];  // Primary diagnoses
  createdAt: string;
  updatedAt: string;
}

/**
 * Patient search result (reduced data for listings)
 */
export interface PatientSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone?: string;
  status: Patient['status'];
  primaryDiagnosis?: string;
}

/**
 * Patient search parameters
 */
export interface PatientSearchParams {
  query: string;
  searchType?: 'name' | 'id' | 'phone' | 'all';
  status?: Patient['status'];
  limit?: number;
  offset?: number;
}

/**
 * Patient search response
 */
export interface PatientSearchResponse {
  results: PatientSearchResult[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
