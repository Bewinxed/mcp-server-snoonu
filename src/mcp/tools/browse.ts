// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browse MCP Tools
 * browse_categories
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { SNOONU_CATEGORIES } from "../../lib/api-client";
import { ok } from "../lib/result";

export function registerBrowseTools(server: McpServer) {
	server.registerTool(
		"browse_categories",
		{
			title: "Browse Categories",
			description: `List all available Snoonu product categories and their internal IDs. Categories include Groceries, Restaurants, Pharmacy, Market, and Flowers. Does not require login.

Use the category name (not the ID) as the "category" parameter in search_products or bulk_search to filter results. Default category is Groceries if not specified.`,
			outputSchema: z.object({
				success: z.literal(true),
				categories: z.array(
					z.object({
						name: z.string(),
						id: z.number(),
					}),
				),
				message: z.string(),
			}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => {
			const categories = Object.entries(SNOONU_CATEGORIES).map(
				([name, id]) => ({ name, id }),
			);

			return ok({
				success: true as const,
				categories,
				message:
					"Use the category name in search_products to filter results.",
			});
		},
	);
}
