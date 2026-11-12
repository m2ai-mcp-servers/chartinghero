/**
 * get_patient_history MCP Tool
 *
 * Retrieves visit history for a patient from the connected EMR.
 */

import { getPatientHistory } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { PatientHistoryParams, VisitType } from '../types/index.js';

/**
 * Tool definition for MCP
 */
export const getPatientHistoryTool = {
  name: 'get_patient_history',
  description: `Retrieve visit history for a patient from the connected EMR.

Returns a list of previous visits with dates, types, and key information. Use this to review patient history before creating a new visit note.

Use search_patient first to get the patient ID.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      patientId: {
        type: 'string',
        description: 'Patient ID from search_patient (e.g., PT-10001)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of visits to return (default: 10, max: 50)',
      },
      startDate: {
        type: 'string',
        description: 'Filter visits on or after this date (YYYY-MM-DD)',
      },
      endDate: {
        type: 'string',
        description: 'Filter visits on or before this date (YYYY-MM-DD)',
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
        description: 'Filter by visit type',
      },
    },
    required: ['patientId'],
  },
};

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
 * Execute the get_patient_history tool
 */
export async function executeGetPatientHistory(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const config = getConfig();

  try {
    const params: PatientHistoryParams = {
      patientId: String(args.patientId || ''),
      limit: Math.min(Number(args.limit) || 10, 50),
      offset: 0,
      startDate: args.startDate as string | undefined,
      endDate: args.endDate as string | undefined,
      visitType: args.visitType as VisitType | undefined,
    };

    const response = await getPatientHistory(params);

    // Format response for Claude
    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    resultText += `**Visit History for ${response.patientName}** (${response.patientId})\n\n`;

    if (response.visits.length === 0) {
      resultText += '_No visits found for the specified criteria._\n';

      if (params.startDate || params.endDate || params.visitType) {
        resultText += '\nFilters applied:\n';
        if (params.startDate) resultText += `  • From: ${params.startDate}\n`;
        if (params.endDate) resultText += `  • To: ${params.endDate}\n`;
        if (params.visitType) resultText += `  • Type: ${formatVisitType(params.visitType)}\n`;
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
    logger.error('get_patient_history failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}
