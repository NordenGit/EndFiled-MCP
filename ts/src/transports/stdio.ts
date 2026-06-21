/**
 * stdio transport — for local Claude Desktop / Claude Code / Chatbox.
 *
 * The simplest deployment: MCP runs as a subprocess, client speaks JSON-RPC
 * over its stdin/stdout. This is what `EF_TRANSPORT=stdio` (the default)
 * gives you.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive on its own; no explicit listen.
}
