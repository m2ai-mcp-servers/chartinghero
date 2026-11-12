/**
 * search_patient MCP Tool
 *
 * Searches for patients in the connected EMR.
 */

import { searchPatients } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { PatientSearchParams } from '../types/index.js';

/**
 * Tool definition for MCP
 */
export const searchPatientTool = {
  name: 'search_patient',
  description: `Search for a patient in the connected EMR by name, ID, or phone number.

Returns matching patient records with basic information. Use this tool to find patients before creating visit notes or retrieving history.

Examples:
- Search by name: "Eleanor Thompson"
- Search by ID: "PT-10001"
- Search by phone: "555-0101"`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search term: patient name, ID (e.g., PT-10001), or phone number',
      },
      searchType: {
        type: 'string',
        enum: ['name', 'id', 'phone', 'all'],
        description: 'Type of search to perform. Defaults to "all" which searches across all fields.',
      },
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'discharged', 'pending'],
        description: 'Filter by patient status. If not specified, returns all statuses.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
      },
    },
    required: ['query'],
  },
};

/**
 * Execute the search_patient tool
 */
export async function executeSearchPatient(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const config = getConfig();

  try {
    const params: PatientSearchParams = {
      query: String(args.query || ''),
      searchType: args.searchType as PatientSearchParams['searchType'],
      status: args.status as PatientSearchParams['status'],
      limit: Math.min(Number(args.limit) || 10, 50),
      offset: 0,
    };

    const response = await searchPatients(params);

    // Format response for Claude
    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    if (response.results.length === 0) {
      resultText += `No patients found matching "${params.query}"`;
    } else {
      resultText += `Found ${response.total} patient(s) matching "${params.query}":\n\n`;

      for (const patient of response.results) {
        resultText += `**${patient.firstName} ${patient.lastName}** (${patient.id})\n`;
        resultText += `  • DOB: ${patient.dateOfBirth}\n`;
        if (patient.phone) {
          resultText += `  • Phone: ${patient.phone}\n`;
        }
        resultText += `  • Status: ${patient.status}\n`;
        if (patient.primaryDiagnosis) {
          resultText += `  • Primary Dx: ${patient.primaryDiagnosis}\n`;
        }
        resultText += '\n';
      }

      if (response.hasMore) {
        resultText += `\n_Showing ${response.results.length} of ${response.total} results_`;
      }
    }

    return {
      content: [{ type: 'text', text: resultText }],
    };
  } catch (error) {
    logger.error('search_patient failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}
