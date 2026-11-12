/**
 * create_visit_note MCP Tool
 *
 * Creates a visit note in the connected EMR.
 */

import { createVisitNote } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { CreateVisitNoteParams, VitalSigns, VisitType } from '../types/index.js';

/**
 * Tool definition for MCP
 */
export const createVisitNoteTool = {
  name: 'create_visit_note',
  description: `Create a visit note for a patient in the connected EMR.

This tool documents a home health visit including vital signs, assessment, and care plan. Use search_patient first to get the patient ID.

Required fields: patientId, visitType, visitDate, timeIn, timeOut
Recommended fields: vitalSigns, subjective, objective, assessment, plan`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      patientId: {
        type: 'string',
        description: 'Patient ID from search_patient (e.g., PT-10001)',
      },
      visitType: {
        type: 'string',
        enum: [
          'skilled_nursing',
          'physical_therapy',
          'occupational_therapy',
          'speech_therapy',
          'home_health_aide',
          'social_work',
          'initial_assessment',
          'recertification',
          'discharge',
          'other',
        ],
        description: 'Type of visit',
      },
      visitDate: {
        type: 'string',
        description: 'Date of visit (YYYY-MM-DD format)',
      },
      timeIn: {
        type: 'string',
        description: 'Time nurse arrived (HH:MM format, 24-hour)',
      },
      timeOut: {
        type: 'string',
        description: 'Time nurse departed (HH:MM format, 24-hour)',
      },
      vitalSigns: {
        type: 'object',
        description: 'Vital signs recorded during visit',
        properties: {
          bloodPressureSystolic: { type: 'number', description: 'Systolic BP (mmHg)' },
          bloodPressureDiastolic: { type: 'number', description: 'Diastolic BP (mmHg)' },
          heartRate: { type: 'number', description: 'Heart rate (bpm)' },
          respiratoryRate: { type: 'number', description: 'Respiratory rate (breaths/min)' },
          temperature: { type: 'number', description: 'Temperature' },
          temperatureUnit: { type: 'string', enum: ['F', 'C'], description: 'Temperature unit' },
          oxygenSaturation: { type: 'number', description: 'O2 saturation (%)' },
          weight: { type: 'number', description: 'Weight' },
          weightUnit: { type: 'string', enum: ['lbs', 'kg'], description: 'Weight unit' },
          painLevel: { type: 'number', description: 'Pain level (0-10)' },
        },
      },
      subjective: {
        type: 'string',
        description: 'Patient\'s reported symptoms, concerns, and statements',
      },
      objective: {
        type: 'string',
        description: 'Nurse\'s observations and physical assessment findings',
      },
      assessment: {
        type: 'string',
        description: 'Clinical assessment and interpretation of findings',
      },
      plan: {
        type: 'string',
        description: 'Care plan and next steps',
      },
      interventions: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of interventions performed during visit',
      },
      patientResponse: {
        type: 'string',
        description: 'How patient responded to care/interventions',
      },
      education: {
        type: 'array',
        items: { type: 'string' },
        description: 'Patient education topics covered',
      },
      nextVisitDate: {
        type: 'string',
        description: 'Scheduled next visit date (YYYY-MM-DD)',
      },
      notes: {
        type: 'string',
        description: 'Additional notes or comments',
      },
    },
    required: ['patientId', 'visitType', 'visitDate', 'timeIn', 'timeOut'],
  },
};

/**
 * Execute the create_visit_note tool
 */
export async function executeCreateVisitNote(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const config = getConfig();

  try {
    const params: CreateVisitNoteParams = {
      patientId: String(args.patientId || ''),
      visitType: args.visitType as VisitType,
      visitDate: String(args.visitDate || ''),
      timeIn: String(args.timeIn || ''),
      timeOut: String(args.timeOut || ''),
      vitalSigns: args.vitalSigns as VitalSigns | undefined,
      subjective: args.subjective as string | undefined,
      objective: args.objective as string | undefined,
      assessment: args.assessment as string | undefined,
      plan: args.plan as string | undefined,
      interventions: args.interventions as string[] | undefined,
      patientResponse: args.patientResponse as string | undefined,
      education: args.education as string[] | undefined,
      nextVisitDate: args.nextVisitDate as string | undefined,
      notes: args.notes as string | undefined,
    };

    const response = await createVisitNote(params);

    // Format response for Claude
    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    if (response.success) {
      resultText += `✅ **Visit Note Created Successfully**\n\n`;
      resultText += `${response.message}\n\n`;
      resultText += `• Note ID: ${response.visitNoteId}\n`;
      if (response.visitNote?.status === 'pending_review') {
        resultText += `• Status: pending review (unsigned; the nurse signs in the EMR)\n`;
      }
      resultText += `• Patient: ${params.patientId}\n`;
      resultText += `• Visit Type: ${params.visitType}\n`;
      resultText += `• Date: ${params.visitDate}\n`;
      resultText += `• Time: ${params.timeIn} - ${params.timeOut}\n`;

      if (response.visitNote?.duration) {
        resultText += `• Duration: ${response.visitNote.duration} minutes\n`;
      }

      if (params.vitalSigns) {
        resultText += `\n**Vital Signs Recorded:**\n`;
        const vs = params.vitalSigns;
        if (vs.bloodPressureSystolic && vs.bloodPressureDiastolic) {
          resultText += `  • BP: ${vs.bloodPressureSystolic}/${vs.bloodPressureDiastolic} mmHg\n`;
        }
        if (vs.heartRate) {
          resultText += `  • HR: ${vs.heartRate} bpm\n`;
        }
        if (vs.temperature) {
          resultText += `  • Temp: ${vs.temperature}°${vs.temperatureUnit || 'F'}\n`;
        }
        if (vs.oxygenSaturation) {
          resultText += `  • O2 Sat: ${vs.oxygenSaturation}%\n`;
        }
        if (vs.weight) {
          resultText += `  • Weight: ${vs.weight} ${vs.weightUnit || 'lbs'}\n`;
        }
      }

      if (params.nextVisitDate) {
        resultText += `\n📅 Next visit scheduled: ${params.nextVisitDate}\n`;
      }
    } else {
      resultText += `❌ **Failed to Create Visit Note**\n\n${response.message}`;
    }

    return {
      content: [{ type: 'text', text: resultText }],
    };
  } catch (error) {
    logger.error('create_visit_note failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}
