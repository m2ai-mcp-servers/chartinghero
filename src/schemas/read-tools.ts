/**
 * Input schemas for the read tools: search_patient and get_patient_history.
 */

import { z } from 'zod';

import { dateSchema, limitSchema, requiredText, STRICT, visitTypeSchema } from './common.js';

export const searchPatientSchema = z.strictObject({
  query: requiredText.describe('Search term: patient name, ID (e.g., PT-10001), or phone number'),
  searchType: z.enum(['name', 'id', 'phone', 'all']).optional()
    .describe('Type of search to perform. Defaults to "all".'),
  status: z.enum(['active', 'inactive', 'discharged', 'pending']).optional()
    .describe('Filter by patient status. Omit for all statuses.'),
  limit: limitSchema.optional().describe('Maximum number of results (1-50, default 10)'),
}, STRICT);

export const patientHistorySchema = z.strictObject({
  patientId: requiredText.describe('Patient ID from search_patient (e.g., PT-10001)'),
  limit: limitSchema.optional().describe('Maximum number of visits (1-50, default 10)'),
  startDate: dateSchema.optional().describe('Visits on or after this date (YYYY-MM-DD)'),
  endDate: dateSchema.optional().describe('Visits on or before this date (YYYY-MM-DD)'),
  visitType: visitTypeSchema.optional().describe('Filter by visit type'),
}, STRICT);

export type SearchPatientInput = z.infer<typeof searchPatientSchema>;
export type PatientHistoryInput = z.infer<typeof patientHistorySchema>;
