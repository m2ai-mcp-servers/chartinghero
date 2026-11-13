/**
 * FHIR code constants for the visit mappers. One place, each with its source.
 * Plan: docs/FHIR-PIVOT-PLAN.md section 4. Profiles are US Core 9.0.0.
 */

import type { Coding } from 'fhir/r4.js';

export const LOINC = 'http://loinc.org';
export const SNOMED = 'http://snomed.info/sct';
export const UCUM = 'http://unitsofmeasure.org';
// https://terminology.hl7.org/CodeSystem-observation-category.html
export const OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
// https://terminology.hl7.org/CodeSystem-v3-ActCode.html
export const V3_ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
// https://terminology.hl7.org/CodeSystem-data-absent-reason.html
export const DATA_ABSENT_REASON = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';
// https://hl7.org/fhir/us/core/CodeSystem-us-core-documentreference-category.html
export const US_CORE_DOCREF_CATEGORY = 'http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category';

const US_CORE_SD = 'http://hl7.org/fhir/us/core/StructureDefinition/';

/** US Core 9.0.0 profile canonicals (https://hl7.org/fhir/us/core/profiles-and-extensions.html). */
export const PROFILE = {
  encounter: `${US_CORE_SD}us-core-encounter`,
  bloodPressure: `${US_CORE_SD}us-core-blood-pressure`,
  heartRate: `${US_CORE_SD}us-core-heart-rate`,
  respiratoryRate: `${US_CORE_SD}us-core-respiratory-rate`,
  bodyTemperature: `${US_CORE_SD}us-core-body-temperature`,
  pulseOximetry: `${US_CORE_SD}us-core-pulse-oximetry`,
  bodyWeight: `${US_CORE_SD}us-core-body-weight`,
  observationLab: `${US_CORE_SD}us-core-observation-lab`,
  documentReference: `${US_CORE_SD}us-core-documentreference`,
  procedure: `${US_CORE_SD}us-core-procedure`,
} as const;

const loinc = (code: string, display: string): Coding => ({ system: LOINC, code, display });
const snomed = (code: string, display: string): Coding => ({ system: SNOMED, code, display });

/** LOINC codes, displays from https://loinc.org/<code>. */
export const CODE = {
  bloodPressurePanel: loinc('85354-9', 'Blood pressure panel with all children optional'),
  systolic: loinc('8480-6', 'Systolic blood pressure'),
  diastolic: loinc('8462-4', 'Diastolic blood pressure'),
  heartRate: loinc('8867-4', 'Heart rate'),
  respiratoryRate: loinc('9279-1', 'Respiratory rate'),
  bodyTemperature: loinc('8310-5', 'Body temperature'),
  // US Core pulse oximetry requires both codings.
  pulseOx: loinc('59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry'),
  o2Sat: loinc('2708-6', 'Oxygen saturation in Arterial blood'),
  inhaledO2FlowRate: loinc('3151-8', 'Inhaled oxygen flow rate'),
  bodyWeight: loinc('29463-7', 'Body weight'),
  // Not in the vital-sign result value set, so the pain Observation carries no profile (Q6).
  painScore: loinc('72514-3', 'Pain severity - 0-10 verbal numeric rating [Score] - Reported'),
  // Q4: own Observation, US Core lab profile.
  glucose: loinc('41653-7', 'Glucose [Mass/volume] in Capillary blood by Glucometer'),
  // SCALE_TYP LP32888-7, so it is in us-core-documentreference-type.
  nurseNote: loinc('34746-8', 'Nurse Note'),
} as const;

export const CATEGORY = {
  vitalSigns: { system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' } as Coding,
  laboratory: { system: OBSERVATION_CATEGORY, code: 'laboratory', display: 'Laboratory' } as Coding,
  clinicalNote: { system: US_CORE_DOCREF_CATEGORY, code: 'clinical-note', display: 'Clinical Note' } as Coding,
};

/** Encounter.class: home health. */
export const CLASS_HOME_HEALTH: Coding = { system: V3_ACT_CODE, code: 'HH', display: 'home health' };

/** In the extensible US Core Encounter Type value set (checked on tx.fhir.org, see plan section 4). */
export const SNOMED_HOME_VISIT = snomed('439708006', 'Home visit');

export const SNOMED_PATIENT_EDUCATION = snomed('311401005', 'Patient education');

/**
 * Interventions with a known SNOMED code. Matched on the trimmed, lower-cased text;
 * anything else stays text-only. No fuzzy matching: a wrong code is worse than none.
 */
export const INTERVENTION_CODES: Readonly<Record<string, Coding>> = {
  'wound care': snomed('225358003', 'Wound care'),
  'dressing change': snomed('385949008', 'Dressing change management'),
  counseling: snomed('409063005', 'Counseling'),
};

/** Q2: suffixes under FHIR_IDENTIFIER_SYSTEM. */
export function identifierSystems(base: string) {
  return {
    patientId: `${base}/patient-id`,
    visit: `${base}/visit`,
    visitType: `${base}/visit-type`,
  };
}

/** meta.tag on non-production writes so test data can be purged (plan 3.3 step 7). */
export const DEV_TAG_CODE = 'chartinghero-dev';
