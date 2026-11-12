/**
 * get_patient_history MCP Tool
 *
 * Retrieves visit history for a patient from the connected EMR.
 */

import { getPatientHistory } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { errorLogFields, formatErrorForMcp } from '../utils/errors.js';
import { patientHistorySchema } from '../schemas/read-tools.js';
import type { PatientHistoryInput } from '../schemas/read-tools.js';
import type { VisitType } from '../types/index.js';
import { READ_ANNOTATIONS } from './types.js';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * Format visit type for display
 */
function formatVisitType(type: VisitType): string {
  const typeMap: Record<VisitType, string> = {
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
  return typeMap[type] || type;
}

/**
 * Execute the get_patient_history tool. Arguments have passed patientHistorySchema.
 */
export async function executeGetPatientHistory(args: PatientHistoryInput): Promise<ToolResult> {
  const config = getConfig();

  try {
    const response = await getPatientHistory({
      patientId: args.patientId,
      limit: args.limit ?? 10,
      offset: 0,
      startDate: args.startDate,
      endDate: args.endDate,
      visitType: args.visitType,
    });

    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    resultText += `**Visit History for ${response.patientName}** (${response.patientId})\n\n`;

    if (response.visits.length === 0) {
      resultText += '_No visits found for the specified criteria._\n';

      if (args.startDate || args.endDate || args.visitType) {
        resultText += '\nFilters applied:\n';
        if (args.startDate) resultText += `  • From: ${args.startDate}\n`;
        if (args.endDate) resultText += `  • To: ${args.endDate}\n`;
        if (args.visitType) resultText += `  • Type: ${formatVisitType(args.visitType)}\n`;
      }
    } else {
      resultText += `Showing ${response.visits.length} of ${response.total} visit(s):\n\n`;

      for (const visit of response.visits) {
        const statusIcon = visit.status === 'completed' ? '✅' : '⏳';
        resultText += `${statusIcon} **${visit.visitDate}** - ${formatVisitType(visit.visitType)}\n`;
        resultText += `   • Duration: ${visit.duration} min | Nurse: ${visit.nurseName}\n`;
        if (visit.hasVitals) {
          resultText += `   • Vitals recorded\n`;
        }
        resultText += '\n';
      }

      if (response.hasMore) {
        resultText += `_Showing ${response.visits.length} of ${response.total} visits. Use limit parameter to see more._\n`;
      }
    }

    return {
      content: [{ type: 'text', text: resultText }],
    };
  } catch (error) {
    logger.error('Tool failed', { tool: 'get_patient_history', ...errorLogFields(error) });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}

export const getPatientHistoryTool: ToolDefinition<typeof patientHistorySchema> = {
  name: 'get_patient_history',
  description: `Retrieve visit history for a patient from the connected EMR.

Returns a list of previous visits with dates, types, and key information. Use this to review patient history before creating a new visit note.

Use search_patient first to get the patient ID.`,
  inputSchema: patientHistorySchema,
  annotations: READ_ANNOTATIONS,
  execute: executeGetPatientHistory,
};
