/**
 * Builds the MCP server. Tools are registered with McpServer.registerTool, so the SDK
 * validates every call against the tool's zod schema before the handler runs: an
 * invalid call never reaches patient-service or a backend.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { logger } from './utils/logger.js';
import { errorLogFields, formatErrorForMcp } from './utils/errors.js';
import { searchPatientTool, createVisitNoteTool, getPatientHistoryTool } from './tools/index.js';
import type { ToolDefinition, ToolResult } from './tools/types.js';

export const TOOLS = [searchPatientTool, createVisitNoteTool, getPatientHistoryTool] as const;

function register<S extends z.ZodObject>(server: McpServer, tool: ToolDefinition<S>): void {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    // The SDK turns a thrown error into a tool result carrying error.message, so nothing
    // may escape this handler unformatted.
    // Cast: the SDK's callback type cannot be resolved for a generic S. The SDK passes the
    // parsed output of tool.inputSchema, which is exactly z.infer<S>.
    (async (args: z.infer<S>): Promise<ToolResult> => {
      logger.info('Tool called', { tool: tool.name });
      try {
        return await tool.execute(args);
      } catch (error) {
        logger.error('Tool execution failed', { tool: tool.name, ...errorLogFields(error) });
        return { content: [formatErrorForMcp(error)], isError: true };
      }
    }) as never
  );
}

export function createServer(version: string): McpServer {
  const server = new McpServer({ name: 'chartinghero', version }, { capabilities: { tools: {} } });
  for (const tool of TOOLS) register(server, tool as ToolDefinition<z.ZodObject>);
  return server;
}
