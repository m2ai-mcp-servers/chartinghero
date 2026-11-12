/**
 * create_visit_note MCP Tool
 *
 * Creates a visit note in the connected EMR.
 */

import { createVisitNote } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { errorLogFields, formatErrorForMcp } from '../utils/errors.js';
import { createVisitNoteSchema } from '../schemas/visit-note.js';
import type { CreateVisitNoteInput } from '../schemas/visit-note.js';
import type { VitalSigns } from '../types/index.js';
import type { ToolDefinition, ToolResult } from './types.js';

/** One line per recorded vital. `!== undefined` so a recorded 0 is shown. */
function formatVitals(vs: VitalSigns): string {
  let text = '';
  if (vs.bloodPressureSystolic !== undefined && vs.bloodPressureDiastolic !== undefined) {
    text += `  • BP: ${vs.bloodPressureSystolic}/${vs.bloodPressureDiastolic} mmHg\n`;
  }
  if (vs.heartRate !== undefined) text += `  • HR: ${vs.heartRate} bpm\n`;
  if (vs.respiratoryRate !== undefined) text += `  • RR: ${vs.respiratoryRate} /min\n`;
  if (vs.temperature !== undefined) text += `  • Temp: ${vs.temperature}°${vs.temperatureUnit}\n`;
  if (vs.oxygenSaturation !== undefined) {
    const flow = vs.oxygenFlowRate === undefined ? '' : vs.oxygenFlowRate === 0 ? ' on room air' : ` on ${vs.oxygenFlowRate} L/min O2`;
    text += `  • O2 Sat: ${vs.oxygenSaturation}%${flow}\n`;
  } else if (vs.oxygenFlowRate !== undefined) {
    text += `  • O2 flow: ${vs.oxygenFlowRate} L/min\n`;
  }
  if (vs.weight !== undefined) text += `  • Weight: ${vs.weight} ${vs.weightUnit}\n`;
  if (vs.painLevel !== undefined) text += `  • Pain: ${vs.painLevel}/10\n`;
  if (vs.bloodGlucose !== undefined) text += `  • Glucose: ${vs.bloodGlucose} mg/dL\n`;
  return text;
}

/**
 * Execute the create_visit_note tool. Arguments have passed createVisitNoteSchema.
 */
export async function executeCreateVisitNote(args: CreateVisitNoteInput): Promise<ToolResult> {
  const config = getConfig();

  try {
    const response = await createVisitNote(args);

    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    if (response.success) {
      resultText += args.dryRun
        ? `🔎 **Dry Run: Visit Note Validated, Nothing Written**\n\n`
        : `✅ **Visit Note Created Successfully**\n\n`;
      resultText += `${response.message}\n\n`;
      if (!args.dryRun) resultText += `• Note ID: ${response.visitNoteId}\n`;
      if (response.visitNote?.status === 'pending_review') {
        resultText += `• Status: pending review (unsigned; the nurse signs in the EMR)\n`;
      }
      resultText += `• Patient: ${args.patientId}\n`;
      resultText += `• Visit Type: ${args.visitType}\n`;
      resultText += `• Date: ${args.visitDate}\n`;
      resultText += `• Time: ${args.timeIn} - ${args.timeOut}${args.overnight ? ' (next day)' : ''}\n`;

      if (response.visitNote?.duration !== undefined) {
        resultText += `• Duration: ${response.visitNote.duration} minutes\n`;
      }

      if (args.vitalSigns) {
        const vitals = formatVitals(args.vitalSigns);
        if (vitals) resultText += `\n**Vital Signs ${args.dryRun ? 'To Record' : 'Recorded'}:**\n${vitals}`;
      }

      if (args.nextVisitDate) {
        resultText += `\n📅 Next visit scheduled: ${args.nextVisitDate}\n`;
      }
    } else {
      resultText += `❌ **Failed to Create Visit Note**\n\n${response.message}`;
    }

    return {
      content: [{ type: 'text', text: resultText }],
    };
  } catch (error) {
    logger.error('Tool failed', { tool: 'create_visit_note', ...errorLogFields(error) });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}

export const createVisitNoteTool: ToolDefinition<typeof createVisitNoteSchema> = {
  name: 'create_visit_note',
  description: `Create a visit note for a patient in the connected EMR.

This tool documents a home health visit including vital signs, assessment, and care plan. Use search_patient first to get the patient ID.

Required fields: patientId, visitType, visitDate, timeIn, timeOut
Recommended fields: vitalSigns, subjective, objective, assessment, plan

Rules: timeOut must be after timeIn unless overnight is true. Blood pressure needs both values. temperature and weight need their unit. Set dryRun to preview without writing, and reuse clientVisitId on retry.`,
  inputSchema: createVisitNoteSchema,
  // idempotentHint stays false until the PR7 idempotency test passes.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  execute: executeCreateVisitNote,
};
