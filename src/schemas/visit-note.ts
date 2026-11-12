/**
 * create_visit_note input schema.
 *
 * Bounds are plausibility limits (docs/FHIR-PIVOT-PLAN.md PR4, approved as Q3), not
 * the dashboard's normal/critical display ranges: a critical reading such as SBP 190
 * or SpO2 88 must chart. Only physiologically implausible values are rejected.
 */

import { z } from 'zod';

import {
  dateSchema,
  minutesOf,
  requiredText,
  timeSchema,
  STRICT,
  timeZoneSchema,
  visitTypeSchema,
} from './common.js';

/** Inclusive [min, max] plausibility bounds. */
export const PLAUSIBILITY = {
  bloodPressureSystolic: [50, 300],
  bloodPressureDiastolic: [20, 200],
  heartRate: [20, 300],
  respiratoryRate: [4, 80],
  temperatureF: [85, 115],
  temperatureC: [29, 46],
  oxygenSaturation: [50, 100],
  oxygenFlowRate: [0, 15],
  weightLbs: [1, 1500],
  weightKg: [0.5, 700],
  // Not in the plan's table (glucose was added by Q4). Proposed, not sourced:
  // wide enough for hyperosmolar readings, rejects obvious unit or typing errors.
  bloodGlucose: [10, 2000],
} as const satisfies Record<string, readonly [number, number]>;

function bounded(key: keyof typeof PLAUSIBILITY, unit: string) {
  const [min, max] = PLAUSIBILITY[key];
  const message = `must be between ${min} and ${max} ${unit}`;
  return z.number().min(min, { message }).max(max, { message });
}

export const vitalSignsSchema = z
  .strictObject({
    bloodPressureSystolic: bounded('bloodPressureSystolic', 'mm[Hg]').optional()
      .describe('Systolic BP (mmHg). Send with bloodPressureDiastolic.'),
    bloodPressureDiastolic: bounded('bloodPressureDiastolic', 'mm[Hg]').optional()
      .describe('Diastolic BP (mmHg). Send with bloodPressureSystolic.'),
    heartRate: bounded('heartRate', '/min').optional().describe('Heart rate (bpm)'),
    respiratoryRate: bounded('respiratoryRate', '/min').optional().describe('Respiratory rate (breaths/min)'),
    temperature: z.number().optional().describe('Temperature. Requires temperatureUnit.'),
    temperatureUnit: z.enum(['F', 'C']).optional().describe('Temperature unit'),
    oxygenSaturation: bounded('oxygenSaturation', '%').optional().describe('O2 saturation (%)'),
    oxygenFlowRate: bounded('oxygenFlowRate', 'L/min').optional()
      .describe('Supplemental O2 flow during the SpO2 reading (L/min); 0 for room air'),
    weight: z.number().optional().describe('Weight. Requires weightUnit.'),
    weightUnit: z.enum(['lbs', 'kg']).optional().describe('Weight unit'),
    painLevel: z.number().int({ message: 'must be an integer from 0 to 10' })
      .min(0, { message: 'must be an integer from 0 to 10' })
      .max(10, { message: 'must be an integer from 0 to 10' })
      .optional().describe('Pain level (0-10)'),
    bloodGlucose: bounded('bloodGlucose', 'mg/dL').optional().describe('Blood glucose (mg/dL)'),
  }, STRICT)
  .superRefine((v, ctx) => {
    const sys = v.bloodPressureSystolic !== undefined;
    const dia = v.bloodPressureDiastolic !== undefined;
    if (sys !== dia) {
      ctx.addIssue({
        code: 'custom',
        path: [sys ? 'bloodPressureDiastolic' : 'bloodPressureSystolic'],
        message: 'blood pressure needs both systolic and diastolic',
      });
    }

    if (v.temperature !== undefined) {
      if (v.temperatureUnit === undefined) {
        ctx.addIssue({ code: 'custom', path: ['temperatureUnit'], message: 'is required when temperature is present' });
      } else {
        const [min, max] = PLAUSIBILITY[v.temperatureUnit === 'F' ? 'temperatureF' : 'temperatureC'];
        if (v.temperature < min || v.temperature > max) {
          ctx.addIssue({
            code: 'custom',
            path: ['temperature'],
            message: `must be between ${min} and ${max} °${v.temperatureUnit}`,
          });
        }
      }
    }

    if (v.weight !== undefined) {
      if (v.weightUnit === undefined) {
        ctx.addIssue({ code: 'custom', path: ['weightUnit'], message: 'is required when weight is present' });
      } else {
        const [min, max] = PLAUSIBILITY[v.weightUnit === 'lbs' ? 'weightLbs' : 'weightKg'];
        if (v.weight < min || v.weight > max) {
          ctx.addIssue({ code: 'custom', path: ['weight'], message: `must be between ${min} and ${max} ${v.weightUnit}` });
        }
      }
    }
  });

export const createVisitNoteSchema = z
  .strictObject({
    patientId: requiredText.describe('Patient ID from search_patient (e.g., PT-10001)'),
    visitType: visitTypeSchema.describe('Type of visit'),
    visitDate: dateSchema.describe('Date of visit (YYYY-MM-DD)'),
    timeIn: timeSchema.describe('Time the nurse arrived (HH:MM, 24-hour)'),
    timeOut: timeSchema.describe('Time the nurse departed (HH:MM, 24-hour). Must be after timeIn unless overnight is true.'),
    overnight: z.boolean().optional()
      .describe('Set true when the visit crosses midnight; timeOut is then on the next day'),
    vitalSigns: vitalSignsSchema.optional().describe('Vital signs recorded during the visit'),
    subjective: z.string().optional().describe("Patient's reported symptoms, concerns, and statements"),
    objective: z.string().optional().describe("Nurse's observations and physical assessment findings"),
    assessment: z.string().optional().describe('Clinical assessment and interpretation of findings'),
    plan: z.string().optional().describe('Care plan and next steps'),
    interventions: z.array(z.string()).optional().describe('Interventions performed during the visit'),
    patientResponse: z.string().optional().describe('How the patient responded to care'),
    education: z.array(z.string()).optional().describe('Patient education topics covered'),
    nextVisitDate: dateSchema.optional().describe('Next visit date (YYYY-MM-DD), after visitDate'),
    notes: z.string().optional().describe('Additional notes or comments'),
    clientVisitId: z.uuid({ message: 'must be a UUID' }).optional()
      .describe('Caller-chosen UUID for this visit. Reuse it on retry so the note is not written twice.'),
    timezone: timeZoneSchema.optional().describe('IANA time zone of the visit; overrides VISIT_TIMEZONE'),
    dryRun: z.boolean().optional().describe('Validate and preview the note without writing it'),
  }, STRICT)
  .superRefine((v, ctx) => {
    const tin = minutesOf(v.timeIn);
    const tout = minutesOf(v.timeOut);
    if (v.overnight === true) {
      if (tout >= tin) {
        ctx.addIssue({
          code: 'custom',
          path: ['timeOut'],
          message: 'must be earlier than timeIn for an overnight visit (it ends the next day)',
        });
      }
    } else if (tout <= tin) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeOut'],
        message: 'must be after timeIn; set overnight: true for a visit that crosses midnight',
      });
    }

    // Both are validated YYYY-MM-DD strings, so string order is date order.
    if (v.nextVisitDate !== undefined && v.nextVisitDate <= v.visitDate) {
      ctx.addIssue({ code: 'custom', path: ['nextVisitDate'], message: 'must be after visitDate' });
    }
  });

export type CreateVisitNoteInput = z.infer<typeof createVisitNoteSchema>;
