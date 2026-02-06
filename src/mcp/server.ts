/**
 * Snoonu Shopping MCP Server (stdio)
 *
 * A standard MCP server using @modelcontextprotocol/sdk that exposes
 * Snoonu shopping tools: search, cart, checkout, and auth.
 *
 * Usage:
 *   npx mcp-server-snoonu
 *   bun run src/mcp/server.ts
 *
 * Register in Claude Code:
 *   claude mcp add snoonu -- npx -y mcp-server-snoonu
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	registerSessionTools,
	registerSearchTools,
	registerCartTools,
	registerCheckoutTools,
	registerBrowseTools,
	registerLocationTools,
} from "./tools/index";

const server = new McpServer({
	name: "mcp-server-snoonu",
	version: "0.1.0",
});

// Register all tools
registerSessionTools(server);
registerSearchTools(server);
registerCartTools(server);
registerCheckoutTools(server);
registerBrowseTools(server);
registerLocationTools(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
