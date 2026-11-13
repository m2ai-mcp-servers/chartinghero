/**
 * Golden cases: the single list both `npm run golden` and the tests read, so the
 * fixtures on disk and the in-process checks cannot drift apart. Synthetic data only.
 */

import { buildVisitBundle } from '../../src/fhir/bundle.js';
import type { WriteProfile } from '../../src/fhir/bundle.js';
import type { VisitMappingContext } from '../../src/fhir/context.js';
import type { CreateVisitNoteParams } from '../../src/types/index.js';

export const SERVER_PATIENT_ID = 'synthetic-patient-0001';

export const CTX: VisitMappingContext = {
  patient: `Patient/${SERVER_PATIENT_ID}`,
  practitioner: { reference: 'Practitioner/synthetic-nurse-0001', display: 'Test Nurse, RN' },
  identifierSystem: 'https://memyselfplusai.com/fhir/chartinghero',
  timezone: 'America/New_York',
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  devTag: true,
};

const BASE: CreateVisitNoteParams = {
  patientId: 'PT-00001',
  visitType: 'skilled_nursing',
  visitDate: '2026-03-09',
  timeIn: '09:00',
  timeOut: '09:45',
};

export const FULL_VITALS = {
  bloodPressureSystolic: 128,
  bloodPressureDiastolic: 82,
  heartRate: 74,
  respiratoryRate: 16,
  temperature: 98.6,
  temperatureUnit: 'F',
  oxygenSaturation: 96,
  weight: 172,
  weightUnit: 'lbs',
  painLevel: 3,
} as const;

export interface GoldenCase {
  name: string;
  note: CreateVisitNoteParams;
  profile: WriteProfile;
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'full-vitals',
    profile: 'full',
    note: {
      ...BASE,
      vitalSigns: { ...FULL_VITALS },
      subjective: 'Reports mild fatigue.',
      objective: 'Alert and oriented.',
      assessment: 'Stable.',
      plan: 'Continue current plan of care.',
    },
  },
  { name: 'bp-only', profile: 'full', note: { ...BASE, vitalSigns: { bloodPressureSystolic: 142, bloodPressureDiastolic: 90 } } },
  { name: 'temp-f', profile: 'full', note: { ...BASE, vitalSigns: { temperature: 99.1, temperatureUnit: 'F' } } },
  { name: 'temp-c', profile: 'full', note: { ...BASE, vitalSigns: { temperature: 37.2, temperatureUnit: 'C' } } },
  { name: 'weight-lbs', profile: 'full', note: { ...BASE, vitalSigns: { weight: 180, weightUnit: 'lbs' } } },
  { name: 'weight-kg', profile: 'full', note: { ...BASE, vitalSigns: { weight: 81.6, weightUnit: 'kg' } } },
  { name: 'pain-only', profile: 'full', note: { ...BASE, vitalSigns: { painLevel: 6 } } },
  { name: 'no-vitals', profile: 'full', note: { ...BASE, assessment: 'No change from last visit.' } },
  {
    name: 'three-interventions',
    profile: 'full',
    note: { ...BASE, interventions: ['Wound care', 'Dressing change', 'Medication reconciliation'] },
  },
  { name: 'education-only', profile: 'full', note: { ...BASE, education: ['Fall prevention', 'Medication schedule'] } },
  {
    name: 'note-only',
    profile: 'note-only',
    note: {
      ...BASE,
      vitalSigns: { ...FULL_VITALS },
      assessment: 'Stable.',
      interventions: ['Wound care'],
      education: ['Fall prevention'],
      nextVisitDate: '2026-03-12',
    },
  },
  {
    name: 'flow-without-spo2',
    profile: 'full',
    note: { ...BASE, vitalSigns: { oxygenFlowRate: 2 } },
  },
  {
    name: 'spo2-with-flow-and-glucose',
    profile: 'full',
    note: { ...BASE, vitalSigns: { oxygenSaturation: 93, oxygenFlowRate: 2, bloodGlucose: 132 } },
  },
  {
    name: 'overnight',
    profile: 'full',
    note: { ...BASE, visitType: 'home_health_aide', timeIn: '23:30', timeOut: '00:15', overnight: true, notes: 'Overnight respite.' },
  },
];

/** Deterministic urn:uuid ids: 00000000-0000-4000-8000-000000000001, ...002, ... */
export function counterIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

export function buildGolden(c: GoldenCase) {
  return buildVisitBundle(c.note, CTX, { profile: c.profile, newId: counterIds() });
}

/**
 * Negative fixtures: the full-vitals bundle with a raw domain unit leaked into the UCUM
 * code. US Core binds these with required bindings, so the HL7 validator must reject them.
 */
export const NEGATIVE_CASES: { name: string; loinc: string; badCode: string }[] = [
  { name: 'neg-weight-lbs-code', loinc: '29463-7', badCode: 'lbs' },
  { name: 'neg-temp-f-code', loinc: '8310-5', badCode: 'F' },
];
