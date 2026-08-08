// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Checkout MCP Tools
 * go_to_checkout, get_payment_methods, select_payment_method, place_order
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getApiHeaders } from "../../lib/session-manager";
import { goToCheckout, syncCartViaBrowser, syncCartToLocalStorage, getPaymentMethods, selectPaymentMethod, clickPlaceOrder, fillDeliveryDetails } from "../../lib/browser";
import { getCart } from "../../lib/api-client";
import { ensureAuthenticated } from "../lib/auth";
import { ok, fail, authRequired } from "../lib/result";
import { hydrate } from "../lib/cart-state";

export function registerCheckoutTools(server: McpServer) {
	server.registerTool(
		"go_to_checkout",
		{
			title: "Go to Checkout",
			description: `Open the Snoonu checkout page in the browser so the user can review and complete their order. Does NOT place the order automatically — the user must confirm payment and delivery details themselves.

Requires login and a non-empty cart. Before navigating, this tool syncs the current cart state to the browser's localStorage so the checkout page displays the correct items. Returns the checkout URL and a cart summary (items, quantities, subtotal).

If the cart is empty, returns an error suggesting add_to_cart. Call get_cart first if you want to show the user their cart contents before proceeding to checkout.`,
			outputSchema: z.object({
				checkout_url: z.string().optional(),
				cart_summary: z.object({
					items_count: z.number(),
					subtotal: z.number(),
					items: z.array(z.object({
						name: z.string(),
						quantity: z.number(),
						total: z.number(),
					})),
				}).optional(),
				message: z.string().optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			if (!(await ensureAuthenticated())) {
				return authRequired("checkout");
			}

			// Rehydrate from the persistent store first, otherwise a cart built
			// in an earlier process looks empty here and checkout wrongly aborts.
			await hydrate();

			// getCart() is now non-destructive (reads from in-memory store)
			const cart = getCart();

			if (cart.items.length === 0) {
				return fail("Cart is empty. Add items first with `add_to_cart`.");
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

			if (!result.success) {
				return fail(result.message);
			}

			return ok({
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
				message: "Checkout page opened. User can review and complete their order.",
			});
		},
	);

	server.registerTool(
		"get_payment_methods",
		{
			title: "Get Payment Methods",
			description: `List available payment methods on the checkout page. Returns each method's index, value, label, and whether it is currently selected.

Requires login and the checkout page to be open (call go_to_checkout first). Use the returned index with select_payment_method to choose one.`,
			outputSchema: z.object({
				methods: z.array(z.object({
					index: z.number(),
					value: z.string(),
					label: z.string(),
					selected: z.boolean(),
				})),
				message: z.string().optional(),
				hint: z.string().optional(),
			}),
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			if (!(await ensureAuthenticated())) {
				return authRequired("get payment methods");
			}

			const result = await getPaymentMethods();

			if (!result.success) {
				return fail(result.message);
			}

			return ok({
				methods: result.methods,
				message: result.message,
				hint: "Use select_payment_method(index) to choose one, then place_order to submit.",
			});
		},
	);

	server.registerTool(
		"select_payment_method",
		{
			title: "Select Payment Method",
			description: `Select a payment method on the checkout page by its index. Get available methods first with get_payment_methods.

Requires the checkout page to be open.`,
			inputSchema: z.object({
				index: z.number().describe("Index of the payment method to select (from get_payment_methods)"),
			}),
			outputSchema: z.object({
				message: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ index }) => {
			if (!(await ensureAuthenticated())) {
				return authRequired("select payment method");
			}

			const result = await selectPaymentMethod(index);

			if (!result.success) {
				return fail(result.message);
			}

			return ok({
				message: result.message,
			});
		},
	);

	server.registerTool(
		"set_delivery_details",
		{
			title: "Set Delivery Details",
			description: `Fill the required delivery detail fields on the Snoonu checkout page: address label, building number, and door number, plus an optional note for the driver.

Snoonu keeps the "Place order" button DISABLED until these fields are filled, so if place_order reports the button is disabled, call this first. Requires login and the checkout page to be open (call go_to_checkout first).

Ask the user for their building and door number rather than guessing — a wrong address means a failed delivery.`,
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Label for the address, e.g. 'Home' or 'Office'"),
				building_number: z
					.string()
					.optional()
					.describe("Building number, e.g. '12'"),
				number_on_door: z
					.string()
					.optional()
					.describe("Door/apartment number, e.g. '4B'"),
				driver_note: z
					.string()
					.optional()
					.describe("Optional note for the delivery driver"),
			}),
			outputSchema: z.object({
				filled: z.array(z.string()),
				message: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ name, building_number, number_on_door, driver_note }) => {
			if (!(await ensureAuthenticated())) return authRequired("set delivery details");

			const result = await fillDeliveryDetails({
				name,
				buildingNumber: building_number,
				numberOnDoor: number_on_door,
				driverNote: driver_note,
			});

			if (!result.success) return fail(result.message);

			return ok({ filled: result.filled, message: result.message });
		},
	);

	server.registerTool(
		"place_order",
		{
			title: "Place Order",
			description: `Click the "Place order" button on the Snoonu checkout page to submit the order. This will charge the selected payment method and initiate delivery.

Requires login, a non-empty cart, the checkout page to be open (go_to_checkout), and a payment method to be selected (select_payment_method). Returns the order confirmation URL on success.

IMPORTANT: This places a real order and charges real money. The agent should confirm with the user before calling this tool.`,
			outputSchema: z.object({
				message: z.string(),
				url: z.string().optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async () => {
			if (!(await ensureAuthenticated())) {
				return authRequired("place order");
			}

			const result = await clickPlaceOrder();

			if (!result.success) {
				return fail(result.message);
			}

			return ok({
				message: result.message,
				url: result.url,
			});
		},
	);
}
