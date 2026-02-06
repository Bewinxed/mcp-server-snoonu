/**
 * Browse MCP Tools
 * browse_categories
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SNOONU_CATEGORIES } from "../../lib/api-client";

export function registerBrowseTools(server: McpServer) {
	server.tool(
		"browse_categories",
		"List available Snoonu categories for searching. Returns category names and their IDs.",
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
