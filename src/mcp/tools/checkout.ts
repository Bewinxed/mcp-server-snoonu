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
		`Open the Snoonu checkout page in the browser so the user can review and complete their order. Does NOT place the order automatically — the user must confirm payment and delivery details themselves.

Requires login and a non-empty cart. Before navigating, this tool syncs the current API cart state to the browser's localStorage so the checkout page displays the correct items. Returns the checkout URL and a cart summary (items, quantities, subtotal).

If the cart is empty, returns an error suggesting add_to_cart. Call get_cart first if you want to show the user their cart contents before proceeding to checkout.`,
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
