// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared MCP server factory.
 * Creates and configures an McpServer with all Snoonu tools registered.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	registerSessionTools,
	registerSearchTools,
	registerCartTools,
	registerCheckoutTools,
	registerBrowseTools,
	registerLocationTools,
} from "./tools/index";

export function createSnoonuServer(): McpServer {
	const server = new McpServer({
		name: "mcp-server-snoonu",
		version: "0.1.0",
	});

	registerSessionTools(server);
	registerSearchTools(server);
	registerCartTools(server);
	registerCheckoutTools(server);
	registerBrowseTools(server);
	registerLocationTools(server);

	return server;
}
