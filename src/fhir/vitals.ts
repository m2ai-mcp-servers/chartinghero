/**
 * Vital signs to Observations (plan section 4).
 *
 * A full set yields 6 profiled vital-signs Observations (BP panel, HR, RR, temperature,
 * SpO2, weight), 1 pain Observation with no profile (Q6), and 1 glucose Observation on
 * the US Core lab profile (Q4). Every vital: status=final, effective = period.start.
 */

import type { CodeableConcept, Coding, Observation, Reference } from 'fhir/r4.js';

import { CATEGORY, CODE, DATA_ABSENT_REASON, PROFILE } from './codes.js';
import { meta } from './context.js';
import type { VisitFacts, VisitMappingContext } from './context.js';
import { quantity, TEMPERATURE_UCUM, UCUM_FIXED, WEIGHT_UCUM } from './units.js';
import type { VitalSigns } from '../types/index.js';

const concept = (...coding: Coding[]): CodeableConcept => ({ coding, text: coding[0].display });

export function buildVitals(
  vs: VitalSigns | undefined,
  ctx: VisitMappingContext,
  facts: VisitFacts,
  encounter?: Reference
): Observation[] {
  if (!vs) return [];

  const base = (profile: string | undefined, category: Coding, code: CodeableConcept): Observation => ({
    resourceType: 'Observation',
    meta: meta(ctx, profile),
    status: 'final',
    category: [{ coding: [category] }],
    code,
    subject: facts.subject,
    ...(encounter ? { encounter } : {}),
    effectiveDateTime: facts.period.start,
    performer: [facts.performer],
  });
  const vital = (profile: string, code: CodeableConcept) => base(profile, CATEGORY.vitalSigns, code);

  const out: Observation[] = [];

  // The schema enforces both-or-neither; the panel carries no root value.
  if (vs.bloodPressureSystolic !== undefined && vs.bloodPressureDiastolic !== undefined) {
    out.push({
      ...vital(PROFILE.bloodPressure, concept(CODE.bloodPressurePanel)),
      component: [
        { code: concept(CODE.systolic), valueQuantity: quantity(vs.bloodPressureSystolic, UCUM_FIXED.mmHg) },
        { code: concept(CODE.diastolic), valueQuantity: quantity(vs.bloodPressureDiastolic, UCUM_FIXED.mmHg) },
      ],
    });
  }

  if (vs.heartRate !== undefined) {
    out.push({ ...vital(PROFILE.heartRate, concept(CODE.heartRate)), valueQuantity: quantity(vs.heartRate, UCUM_FIXED.perMin) });
  }

  if (vs.respiratoryRate !== undefined) {
    out.push({
      ...vital(PROFILE.respiratoryRate, concept(CODE.respiratoryRate)),
      valueQuantity: quantity(vs.respiratoryRate, UCUM_FIXED.perMin),
    });
  }

  // The schema requires the unit whenever the value is present.
  if (vs.temperature !== undefined && vs.temperatureUnit !== undefined) {
    out.push({
      ...vital(PROFILE.bodyTemperature, concept(CODE.bodyTemperature)),
      valueQuantity: quantity(vs.temperature, TEMPERATURE_UCUM[vs.temperatureUnit]),
    });
  }

  // Flow rate is a component of the pulse-ox Observation (Q4). Flow without a reading
  // keeps the flow and records the missing SpO2 as dataAbsentReason, instead of dropping it.
  if (vs.oxygenSaturation !== undefined || vs.oxygenFlowRate !== undefined) {
    const obs: Observation = vital(PROFILE.pulseOximetry, concept(CODE.pulseOx, CODE.o2Sat));
    if (vs.oxygenSaturation !== undefined) {
      obs.valueQuantity = quantity(vs.oxygenSaturation, UCUM_FIXED.percent);
    } else {
      obs.dataAbsentReason = { coding: [{ system: DATA_ABSENT_REASON, code: 'not-performed', display: 'Not Performed' }] };
    }
    if (vs.oxygenFlowRate !== undefined) {
      obs.component = [
        { code: concept(CODE.inhaledO2FlowRate), valueQuantity: quantity(vs.oxygenFlowRate, UCUM_FIXED.litersPerMin) },
      ];
    }
    out.push(obs);
  }

  if (vs.weight !== undefined && vs.weightUnit !== undefined) {
    out.push({
      ...vital(PROFILE.bodyWeight, concept(CODE.bodyWeight)),
      valueQuantity: quantity(vs.weight, WEIGHT_UCUM[vs.weightUnit]),
    });
  }

  if (vs.painLevel !== undefined) {
    out.push({ ...base(undefined, CATEGORY.vitalSigns, concept(CODE.painScore)), valueInteger: vs.painLevel });
  }

  if (vs.bloodGlucose !== undefined) {
    out.push({
      ...base(PROFILE.observationLab, CATEGORY.laboratory, concept(CODE.glucose)),
      valueQuantity: quantity(vs.bloodGlucose, UCUM_FIXED.mgPerDl),
    });
  }

  return out;
}
