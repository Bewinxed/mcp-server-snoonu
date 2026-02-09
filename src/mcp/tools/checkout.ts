/**
 * Checkout MCP Tools
 * go_to_checkout
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAuthenticated } from "../../lib/session-manager";
import { goToCheckout, syncCartToLocalStorage } from "../../lib/browser";
import { getCart } from "../../lib/api-client";

export function registerCheckoutTools(server: McpServer) {
	server.tool(
		"go_to_checkout",
		"Navigate the browser to the Snoonu checkout page. Does NOT place the order — just opens checkout for the user to review and complete. Requires login.",
		{},
		async () => {
			if (!isAuthenticated()) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message:
									"Must be logged in to checkout. Use `login` tool first.",
							}),
						},
					],
				};
			}

			const cart = await getCart();

			if (cart.items.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message:
									"Cart is empty. Add items first with `add_to_cart`.",
							}),
						},
					],
				};
			}

			// Sync API cart state → browser localStorage so the Next.js
			// checkout page sees the correct items when it loads.
			await syncCartToLocalStorage(cart.items);

			const result = await goToCheckout();

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							checkout_url: result.url,
							cart_summary: {
								items_count: cart.totalQuantity,
								subtotal: cart.totalPrice,
								items: cart.items.map((item) => ({
									name: item.name,
									quantity: item.quantity,
									total: item.totalPrice,
								})),
							},
							message: result.success
								? "Checkout page opened. User can review and complete their order."
								: result.message,
						}),
					},
				],
			};
		}
	);
}
