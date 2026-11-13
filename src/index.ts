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

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ConfigError, getConfig, MOCK_BANNER } from './config.js';
import type { ChartingHeroConfig } from './config.js';
import { getBackend } from './services/patient-service.js';
import { logger } from './utils/logger.js';
import { ChartingHeroError, errorLogFields } from './utils/errors.js';
import type { PatientBackend } from './backends/types.js';
import { createServer } from './server.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };

/** Only this codebase's own messages reach stderr; anything else is named by class. */
function startupMessage(error: unknown): string {
  if (error instanceof ChartingHeroError) return error.message;
  return `unexpected ${error instanceof Error ? error.name : 'error'} while starting the backend`;
}

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
let backend: PatientBackend;
try {
  backend = getBackend();
} catch (error) {
  fail([startupMessage(error)]);
}

const server = createServer(VERSION);

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

  // FHIR: read /metadata now, so a wrong or unreachable server aborts startup.
  try {
    await backend.init?.();
  } catch (error) {
    fail([startupMessage(error)]);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('ChartingHero MCP server running on stdio');
}

main().catch((error) => {
  logger.error('Fatal error', errorLogFields(error));
  process.exit(1);
});
