/**
 * search_patient MCP Tool
 *
 * Searches for patients in the connected EMR.
 */

import { searchPatients } from '../services/patient-service.js';
import { getConfig, MOCK_BANNER } from '../config.js';
import { logger } from '../utils/logger.js';
import { errorLogFields, formatErrorForMcp } from '../utils/errors.js';
import { searchPatientSchema } from '../schemas/read-tools.js';
import type { SearchPatientInput } from '../schemas/read-tools.js';
import { READ_ANNOTATIONS } from './types.js';
import type { ToolDefinition, ToolResult } from './types.js';

/**
 * Execute the search_patient tool. Arguments have passed searchPatientSchema.
 */
export async function executeSearchPatient(args: SearchPatientInput): Promise<ToolResult> {
  const config = getConfig();

  try {
    const response = await searchPatients({
      query: args.query,
      searchType: args.searchType,
      status: args.status,
      limit: args.limit ?? 10,
      cursor: args.cursor,
    });

    let resultText = '';

    if (config.backend === 'mock') {
      resultText += `${MOCK_BANNER}\n\n`;
    }

    const total = `${response.total}${response.totalIsLowerBound ? '+' : ''}`;
    if (response.results.length === 0 && response.nextCursor) {
      // A page can come back empty after filtering while later pages still hold matches.
      resultText += `No matches on this page for "${args.query}", but more pages exist.`;
      resultText += `\n_Next page: repeat this search with cursor "${response.nextCursor}"_`;
    } else if (response.results.length === 0) {
      resultText += `No patients found matching "${args.query}"`;
    } else {
      resultText += `Found ${total} patient(s) matching "${args.query}":\n\n`;

      for (const patient of response.results) {
        resultText += `**${patient.firstName} ${patient.lastName}** (${patient.id})\n`;
        if (patient.identifier) {
          resultText += `  • Identifier: ${patient.identifier}\n`;
        }
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
        resultText += `\n_Showing ${response.results.length} of ${total} results_`;
        resultText += response.nextCursor
          ? `\n_Next page: repeat this search with cursor "${response.nextCursor}"_`
          : '\n_Narrow the search to see the rest._';
      }
    }

    return {
      content: [{ type: 'text', text: resultText }],
    };
  } catch (error) {
    logger.error('Tool failed', { tool: 'search_patient', ...errorLogFields(error) });

    return {
      content: [formatErrorForMcp(error)],
      isError: true,
    };
  }
}

export const searchPatientTool: ToolDefinition<typeof searchPatientSchema> = {
  name: 'search_patient',
  description: `Search for a patient in the connected EMR by name, ID, or phone number.

Returns matching patient records with basic information. Use this tool to find patients before creating visit notes or retrieving history.

Examples:
- Search by name: "Eleanor Thompson"
- Search by name and date of birth (safest by voice): "Thompson 1942-03-15"
- Search by ID: "PT-10001"
- Search by phone: "555-0101"`,
  inputSchema: searchPatientSchema,
  annotations: READ_ANNOTATIONS,
  execute: executeSearchPatient,
};
