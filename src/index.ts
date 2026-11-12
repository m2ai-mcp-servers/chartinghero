#!/usr/bin/env node

/**
 * ChartingHero MCP Server
 *
 * MCP server for clinical charting against an EMR backend.
 * Enables Claude to document patient visits directly into EMR.
 *
 * BACKEND selects mock (fictional test data) or fhir. Config fails closed;
 * see README and docs/FHIR-PIVOT-PLAN.md section 3.2.
 */

import { createRequire } from 'node:module';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ConfigError, getConfig, MOCK_BANNER } from './config.js';
import type { ChartingHeroConfig } from './config.js';
import { getBackend } from './services/patient-service.js';
import { logger } from './utils/logger.js';
import { errorLogFields, formatErrorForMcp } from './utils/errors.js';
import {
  searchPatientTool,
  executeSearchPatient,
  createVisitNoteTool,
  executeCreateVisitNote,
  getPatientHistoryTool,
  executeGetPatientHistory,
} from './tools/index.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };

function fail(lines: string[]): never {
  for (const line of lines) console.error(`[CHARTINGHERO] startup aborted: ${line}`);
  process.exit(1);
}

// Load and validate configuration (fails closed)
let config: ChartingHeroConfig;
try {
  config = getConfig();
} catch (error) {
  if (error instanceof ConfigError) fail(error.problems);
  throw error;
}

for (const warning of config.warnings) logger.warn(warning);

// Build the backend now so an unavailable backend aborts startup, not the first tool call.
try {
  getBackend();
} catch (error) {
  fail([error instanceof Error ? error.message : String(error)]);
}

// Create MCP server instance
const server = new Server(
  {
    name: 'chartinghero',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  searchPatientTool,
  createVisitNoteTool,
  getPatientHistoryTool,
];

// Tool executor map
const toolExecutors: Record<string, (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>> = {
  search_patient: executeSearchPatient,
  create_visit_note: executeCreateVisitNote,
  get_patient_history: executeGetPatientHistory,
};

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug('Listing tools');
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  logger.info('Tool called', { tool: TOOLS.some((t) => t.name === name) ? name : 'unknown' });

  // Own properties only: a name like 'constructor' must not resolve to Object.prototype.
  const executor = Object.hasOwn(toolExecutors, name) ? toolExecutors[name] : undefined;

  if (!executor) {
    logger.warn('Unknown tool requested');
    return {
      content: [
        {
          type: 'text',
          text: `Unknown tool. Available tools: ${TOOLS.map(t => t.name).join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await executor(args || {});
    return result;
  } catch (error) {
    logger.error('Tool execution failed', { tool: name, ...errorLogFields(error) });
    return { content: [formatErrorForMcp(error)], isError: true };
  }
});

// Start the server
async function main() {
  logger.info(
    `Starting ChartingHero MCP server v${VERSION} (backend=${config.backend}, dashboardSync=${config.dashboardSync ? 'on' : 'off'})`
  );

  if (config.backendDefaulted) {
    logger.warn(`BACKEND not set: using the mock backend. ${MOCK_BANNER} Set BACKEND=mock to make this explicit.`);
  } else if (config.backend === 'mock') {
    logger.warn(`Mock backend: ${MOCK_BANNER}`);
  }

  if (config.dashboardSync && !config.supabaseEnabled) {
    logger.warn('DASHBOARD_SYNC=on but SUPABASE_URL or SUPABASE_ANON_KEY is missing; sync calls will fail');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('ChartingHero MCP server running on stdio');
}

main().catch((error) => {
  logger.error('Fatal error', errorLogFields(error));
  process.exit(1);
});
