/**
 * Visit to US Core Encounter. status=finished: the visit happened and timeOut is known
 * (plan 3.3, status semantics).
 */

import type { Encounter } from 'fhir/r4.js';

import { CLASS_HOME_HEALTH, PROFILE, SNOMED_HOME_VISIT } from './codes.js';
import { meta } from './context.js';
import type { VisitFacts, VisitMappingContext } from './context.js';
import type { CreateVisitNoteParams, VisitType } from '../types/index.js';

export const VISIT_TYPE_LABEL: Readonly<Record<VisitType, string>> = {
  skilled_nursing: 'Skilled Nursing',
  physical_therapy: 'Physical Therapy',
  occupational_therapy: 'Occupational Therapy',
  speech_therapy: 'Speech Therapy',
  home_health_aide: 'Home Health Aide',
  social_work: 'Social Work',
  initial_assessment: 'Initial Assessment',
  recertification: 'Recertification',
  discharge: 'Discharge',
  other: 'Other',
};

export function buildEncounter(note: CreateVisitNoteParams, ctx: VisitMappingContext, facts: VisitFacts): Encounter {
  return {
    resourceType: 'Encounter',
    meta: meta(ctx, PROFILE.encounter),
    identifier: [{ system: facts.systems.visit, value: ctx.idempotencyKey }],
    status: 'finished',
    class: CLASS_HOME_HEALTH,
    type: [
      {
        coding: [
          { system: facts.systems.visitType, code: note.visitType, display: VISIT_TYPE_LABEL[note.visitType] },
          SNOMED_HOME_VISIT,
        ],
        text: VISIT_TYPE_LABEL[note.visitType],
      },
    ],
    subject: facts.subject,
    participant: [{ individual: facts.performer }],
    period: facts.period,
  };
}
