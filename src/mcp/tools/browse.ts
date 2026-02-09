/**
 * Browse MCP Tools
 * browse_categories
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SNOONU_CATEGORIES } from "../../lib/api-client";

export function registerBrowseTools(server: McpServer) {
	server.tool(
		"browse_categories",
		`List all available Snoonu product categories and their internal IDs. Categories include Groceries, Restaurants, Pharmacy, Market, and Flowers. Does not require login.

Use the category name (not the ID) as the "category" parameter in search_products or bulk_search to filter results. Default category is Groceries if not specified.`,
		{},
		async () => {
			const categories = Object.entries(SNOONU_CATEGORIES).map(
				([name, id]) => ({ name, id })
			);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
							categories,
							message:
								"Use the category name in search_products to filter results.",
						}),
					},
				],
			};
		}
	);
}
