/**
 * Shape of a tool module. src/server.ts registers each one with McpServer.registerTool,
 * which validates arguments against inputSchema before execute runs.
 */

import type { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  execute(args: z.infer<S>): Promise<ToolResult>;
}

/** Reads: no side effects, data comes from an external system. */
export const READ_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
