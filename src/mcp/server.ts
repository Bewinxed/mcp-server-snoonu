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
 *
 * Speaks MCP 2026-07-28. `serveStdio` defaults to legacy: 'serve', so a
 * 2025-era client that opens with `initialize` is still served correctly from
 * the same factory — no branching needed here.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createSnoonuServer } from "./create-server";
import { flush } from "./lib/store";
import { closeAllBrowsers } from "../lib/browser";

const handle = await serveStdio(createSnoonuServer);

async function shutdown(): Promise<void> {
	// Flush pending store writes so a cart mutation isn't lost on exit.
	await flush().catch(() => {});
	await closeAllBrowsers().catch(() => {});
	await handle.close().catch(() => {});
	process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
