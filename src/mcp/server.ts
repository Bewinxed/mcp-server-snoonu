// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Snoonu Shopping MCP Server (stdio)
 *
 * Usage:
 *   npx mcp-server-snoonu
 *   bun run src/mcp/server.ts
 *
 * Register in Claude Code:
 *   claude mcp add snoonu -- npx -y mcp-server-snoonu
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSnoonuServer } from "./create-server";

const server = createSnoonuServer();
const transport = new StdioServerTransport();

process.stdin.resume();

await server.connect(transport);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
