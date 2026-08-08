// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared MCP server factory.
 *
 * Under SDK v2 this is a *factory*: `serveStdio()` and `createMcpHandler()`
 * both build a fresh McpServer per connection/request, because MCP 2026-07-28
 * removed protocol sessions. All durable state lives in ./lib/store.ts, not in
 * the server instance.
 */

import { McpServer } from "@modelcontextprotocol/server";
import {
	registerSessionTools,
	registerSearchTools,
	registerCartTools,
	registerCheckoutTools,
	registerBrowseTools,
	registerLocationTools,
} from "./tools/index";
import { version } from "../version";

const INSTRUCTIONS = `Shopping assistant for Snoonu, Qatar's delivery platform.

Typical flow:
  1. search_products (or bulk_search for a multi-item grocery list) to find items.
  2. add_to_cart with the product_id values returned by search.
  3. get_cart to review, then go_to_checkout.
  4. get_payment_methods -> select_payment_method -> place_order.

Authentication resolves automatically from the saved session; you do not need to
call init_session first. If a tool reports it needs login, call login with the
user's phone number and then verify_otp with the code they receive by SMS.

Search and browse work anonymously. Cart, checkout, and address tools require login.

place_order spends real money. Always confirm the cart contents and total with the
user before calling it.`;

export function createSnoonuServer(): McpServer {
	const server = new McpServer(
		{
			name: "mcp-server-snoonu",
			version,
			description: "Search, cart, and checkout on Snoonu (Qatar delivery)",
		},
		{
			instructions: INSTRUCTIONS,
			capabilities: { tools: {} },
		},
	);

	registerSessionTools(server);
	registerSearchTools(server);
	registerCartTools(server);
	registerCheckoutTools(server);
	registerBrowseTools(server);
	registerLocationTools(server);

	return server;
}
