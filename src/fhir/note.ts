/**
 * Narrative content to a US Core DocumentReference (Nurse Note). docStatus stays
 * preliminary until an explicit sign (Q5); nextVisitDate is note text only (Q7).
 *
 * In the `note-only` write profile (plan 3.3 step 8) the note is the only resource, so it
 * also carries the visit header and the vitals as text, and has no encounter reference.
 */

import type { DocumentReference, Reference } from 'fhir/r4.js';

import { CATEGORY, CODE, PROFILE } from './codes.js';
import { meta } from './context.js';
import type { VisitFacts, VisitMappingContext } from './context.js';
import { VISIT_TYPE_LABEL } from './encounter.js';
import type { CreateVisitNoteParams, VitalSigns } from '../types/index.js';

function vitalsLines(vs: VitalSigns): string[] {
  const lines: string[] = [];
  if (vs.bloodPressureSystolic !== undefined && vs.bloodPressureDiastolic !== undefined) {
    lines.push(`BP: ${vs.bloodPressureSystolic}/${vs.bloodPressureDiastolic} mmHg`);
  }
  if (vs.heartRate !== undefined) lines.push(`HR: ${vs.heartRate} /min`);
  if (vs.respiratoryRate !== undefined) lines.push(`RR: ${vs.respiratoryRate} /min`);
  if (vs.temperature !== undefined) lines.push(`Temp: ${vs.temperature} °${vs.temperatureUnit}`);
  if (vs.oxygenSaturation !== undefined) lines.push(`SpO2: ${vs.oxygenSaturation}%`);
  if (vs.oxygenFlowRate !== undefined) lines.push(`O2 flow: ${vs.oxygenFlowRate} L/min`);
  if (vs.weight !== undefined) lines.push(`Weight: ${vs.weight} ${vs.weightUnit}`);
  if (vs.painLevel !== undefined) lines.push(`Pain: ${vs.painLevel}/10`);
  if (vs.bloodGlucose !== undefined) lines.push(`Glucose: ${vs.bloodGlucose} mg/dL`);
  return lines;
}

/** Plain-text note body. Sections appear only when present, in a fixed order. */
export function noteText(note: CreateVisitNoteParams, opts: { includeVisitAndVitals: boolean }): string {
  const sections: string[] = [];
  const add = (heading: string, body: string | undefined) => {
    if (body !== undefined && body.trim() !== '') sections.push(`${heading}:\n${body.trim()}`);
  };
  const list = (items: string[] | undefined) => {
    const kept = (items ?? []).map((i) => i.trim()).filter((i) => i !== '');
    return kept.length ? kept.map((i) => `- ${i}`).join('\n') : undefined;
  };

  if (opts.includeVisitAndVitals) {
    const end = note.overnight ? `${note.timeOut} (next day)` : note.timeOut;
    add('Visit', `${VISIT_TYPE_LABEL[note.visitType]}, ${note.visitDate} ${note.timeIn} to ${end}`);
    if (note.vitalSigns) add('Vital signs', vitalsLines(note.vitalSigns).join('\n'));
  }
  add('Subjective', note.subjective);
  add('Objective', note.objective);
  add('Assessment', note.assessment);
  add('Plan', note.plan);
  add('Interventions', list(note.interventions));
  add('Patient response', note.patientResponse);
  add('Education', list(note.education));
  add('Next visit', note.nextVisitDate);
  add('Notes', note.notes);
  return sections.join('\n\n');
}

export function buildNote(
  note: CreateVisitNoteParams,
  ctx: VisitMappingContext,
  facts: VisitFacts,
  opts: { encounter?: Reference; includeVisitAndVitals: boolean }
): DocumentReference | undefined {
  const text = noteText(note, { includeVisitAndVitals: opts.includeVisitAndVitals });
  if (text === '') return undefined;

  return {
    resourceType: 'DocumentReference',
    meta: meta(ctx, PROFILE.documentReference),
    status: 'current',
    docStatus: 'preliminary',
    type: { coding: [CODE.nurseNote], text: CODE.nurseNote.display },
    category: [{ coding: [CATEGORY.clinicalNote] }],
    subject: facts.subject,
    date: facts.period.end,
    author: [facts.performer],
    content: [
      {
        attachment: {
          // UTF-8 bytes (the degree sign, accented names); without charset text/plain means US-ASCII.
          contentType: 'text/plain; charset=utf-8',
          data: Buffer.from(text, 'utf8').toString('base64'),
          title: 'Visit note',
        },
      },
    ],
    context: {
      ...(opts.encounter ? { encounter: [opts.encounter] } : {}),
      period: facts.period,
    },
  };
}
