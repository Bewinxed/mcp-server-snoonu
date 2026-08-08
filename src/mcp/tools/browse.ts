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
			description: `List all available Snoonu product categories and their internal IDs. Categories include Groceries, Restaurants, Pharmacy, Flowers & Gifts, Charity, Tamwin, and Services. Does not require login.

Category is OPTIONAL on search_products and bulk_search — omit it to search across everything, which is what snoonu.com itself does. Only pass a category when you specifically want to narrow the results.

Use the category name (not the ID) as the "category" parameter in search_products or bulk_search to filter results. If omitted, the search covers all categories.`,
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
			const categories: Array<{ name: string; id: number }> =
				Object.entries(SNOONU_CATEGORIES).map(([name, id]) => ({
					name,
					id: id as number,
				}));

			// Market is accepted by search_products/bulk_search but is not a
			// /v5/search/global category id — it routes to the Snoomarket API.
			// List it anyway, otherwise the model never learns it exists.
			categories.push({ name: "Market", id: 3895 });

			return ok({
				success: true as const,
				categories,
				message:
					"Use the category name in search_products to narrow results. Omitting it searches everything, which usually returns more.",
			});
		},
	);
}
