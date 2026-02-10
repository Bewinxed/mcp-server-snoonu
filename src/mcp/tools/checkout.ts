// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Checkout MCP Tools
 * go_to_checkout, get_payment_methods, select_payment_method, place_order
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAuthenticated, getApiHeaders } from "../../lib/session-manager";
import { goToCheckout, syncCartViaBrowser, syncCartToLocalStorage, getPaymentMethods, selectPaymentMethod, clickPlaceOrder } from "../../lib/browser";
import { getCart } from "../../lib/api-client";

export function registerCheckoutTools(server: McpServer) {
	server.tool(
		"go_to_checkout",
		`Open the Snoonu checkout page in the browser so the user can review and complete their order. Does NOT place the order automatically — the user must confirm payment and delivery details themselves.

Requires login and a non-empty cart. Before navigating, this tool syncs the current cart state to the browser's localStorage so the checkout page displays the correct items. Returns the checkout URL and a cart summary (items, quantities, subtotal).

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

			// getCart() is now non-destructive (reads from in-memory store)
			const cart = getCart();

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

			// Sync cart to browser: (1) replay the multicart/sync API call
			// from within the browser so the SSR checkout page sees the items,
			// (2) write to localStorage for the Next.js frontend hydration.
			const headers = getApiHeaders();
			await syncCartViaBrowser(
				cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
				headers
			);
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

	server.tool(
		"get_payment_methods",
		`List available payment methods on the checkout page. Returns each method's index, value, label, and whether it is currently selected.

Requires login and the checkout page to be open (call go_to_checkout first). Use the returned index with select_payment_method to choose one.`,
		{},
		async () => {
			if (!isAuthenticated()) {
				return { content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Must be logged in. Call init_session first, then login." }) }] };
			}

			const result = await getPaymentMethods();

			return {
				content: [{
					type: "text" as const,
					text: JSON.stringify({
						success: result.success,
						methods: result.methods,
						message: result.message,
						hint: result.success ? "Use select_payment_method(index) to choose one, then place_order to submit." : undefined,
					}),
				}],
			};
		},
	);

	server.tool(
		"select_payment_method",
		`Select a payment method on the checkout page by its index. Get available methods first with get_payment_methods.

Requires the checkout page to be open.`,
		{
			index: z.number().describe("Index of the payment method to select (from get_payment_methods)"),
		},
		async ({ index }) => {
			if (!isAuthenticated()) {
				return { content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Must be logged in." }) }] };
			}

			const result = await selectPaymentMethod(index);

			return {
				content: [{
					type: "text" as const,
					text: JSON.stringify({
						success: result.success,
						message: result.message,
					}),
				}],
			};
		},
	);

	server.tool(
		"place_order",
		`Click the "Place order" button on the Snoonu checkout page to submit the order. This will charge the selected payment method and initiate delivery.

Requires login, a non-empty cart, the checkout page to be open (go_to_checkout), and a payment method to be selected (select_payment_method). Returns the order confirmation URL on success.

IMPORTANT: This places a real order and charges real money. The agent should confirm with the user before calling this tool.`,
		{},
		async () => {
			if (!isAuthenticated()) {
				return { content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: "Must be logged in." }) }] };
			}

			const result = await clickPlaceOrder();

			return {
				content: [{
					type: "text" as const,
					text: JSON.stringify({
						success: result.success,
						message: result.message,
						url: result.url,
					}),
				}],
			};
		},
	);
}
