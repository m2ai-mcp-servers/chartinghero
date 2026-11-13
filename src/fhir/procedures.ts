/**
 * Interventions and education to US Core Procedures (`full` profile only).
 * One Procedure per intervention; one Procedure for all education topics.
 */

import type { Procedure, Reference } from 'fhir/r4.js';

import { INTERVENTION_CODES, PROFILE, SNOMED_PATIENT_EDUCATION } from './codes.js';
import { meta } from './context.js';
import type { VisitFacts, VisitMappingContext } from './context.js';
import type { CreateVisitNoteParams } from '../types/index.js';

export function interventionCoding(text: string) {
  const key = text.trim().toLowerCase();
  // Own keys only: 'constructor' or '__proto__' must not resolve to Object.prototype members.
  return Object.hasOwn(INTERVENTION_CODES, key) ? INTERVENTION_CODES[key] : undefined;
}

export function buildProcedures(
  note: CreateVisitNoteParams,
  ctx: VisitMappingContext,
  facts: VisitFacts,
  encounter?: Reference
): Procedure[] {
  const base = (): Omit<Procedure, 'code'> => ({
    resourceType: 'Procedure',
    meta: meta(ctx, PROFILE.procedure),
    status: 'completed',
    subject: facts.subject,
    ...(encounter ? { encounter } : {}),
    performedPeriod: facts.period,
    performer: [{ actor: facts.performer }],
  });

  const out: Procedure[] = [];

  for (const text of note.interventions ?? []) {
    if (text.trim() === '') continue;
    const coding = interventionCoding(text);
    out.push({ ...base(), code: { ...(coding ? { coding: [coding] } : {}), text: text.trim() } });
  }

  const topics = (note.education ?? []).map((t) => t.trim()).filter((t) => t !== '');
  if (topics.length > 0) {
    out.push({
      ...base(),
      code: { coding: [SNOMED_PATIENT_EDUCATION], text: SNOMED_PATIENT_EDUCATION.display },
      note: topics.map((text) => ({ text })),
    });
  }

  return out;
}
