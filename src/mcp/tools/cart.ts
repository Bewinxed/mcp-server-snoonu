// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cart MCP Tools
 * add_to_cart, get_cart, remove_from_cart, clear_cart
 *
 * Uses an in-memory cart store (api-client) as the source of truth for a sync
 * cycle, rehydrated from the persistent store (../lib/store) on each call so a
 * cart survives process restarts.
 *
 * multicart/sync is a FULL REPLACEMENT endpoint — sending empty items clears
 * the server cart, so we never call it to "read".
 *
 * After every cart mutation we sync to browser localStorage via
 * syncCartToLocalStorage(). Snoonu's Next.js frontend reads cart from
 * `marketplaceCartProducts` in localStorage.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	addToCart,
	getCart,
	syncCart,
	clearCartOnServer,
} from "../../lib/api-client";
import { syncCartToLocalStorage } from "../../lib/browser";
import { ok, fail, authRequired } from "../lib/result";
import { ensureAuthenticated } from "../lib/auth";
import { getProduct } from "../lib/store";
import { hydrate, persist } from "../lib/cart-state";

const cartSummaryOutput = z.object({
	added: z.number().optional(),
	removed: z.string().optional(),
	cleared: z.number().optional(),
	cart_total: z.number(),
	items_count: z.number(),
	skipped: z
		.array(z.object({ product_id: z.string(), reason: z.string() }))
		.optional(),
	message: z.string().optional(),
});

const getCartOutput = z.object({
	empty: z.boolean().optional(),
	items: z.array(
		z.object({
			product_id: z.string(),
			name: z.string(),
			qty: z.number(),
			price: z.number(),
			total: z.number(),
		}),
	),
	subtotal: z.number().optional(),
	total: z.number().optional(),
	items_count: z.number().optional(),
});

export function registerCartTools(server: McpServer) {
	server.registerTool(
		"add_to_cart",
		{
			title: "Add to Cart",
			description: `Add one or more products to the Snoonu shopping cart. Accepts an array of {product_id, quantity} objects — use the product_id values from search_products, bulk_search, or search_in_merchant results.

Requires login. Syncs the cart both server-side (via the multicart API) and to the browser's localStorage so the Snoonu checkout page reflects changes immediately.

Returns a summary with items added, cart total, and item count. Use get_cart for the full item listing with per-item details. All items must be from merchants available at the current delivery location.`,
			inputSchema: z.object({
				items: z
					.array(
						z.object({
							product_id: z
								.string()
								.min(1)
								.describe("Product ID from search results"),
							quantity: z
								.number()
								.int()
								.positive()
								.optional()
								.describe("Quantity to add (default: 1)"),
						}),
					)
					.min(1)
					.describe("Array of items to add"),
			}),
			outputSchema: cartSummaryOutput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ items }) => {
			if (!(await ensureAuthenticated())) return authRequired("add items to cart");
			await hydrate();

			// Resolve product metadata from the persistent store. Previously an
			// unknown id silently produced an entry with undefined name/merchant/
			// price, which the API then rejected or recorded as a 0-priced item.
			// Now unknown ids are reported instead of corrupting the cart.
			const enriched: Array<{
				productId: string;
				quantity: number;
				name: string;
				merchantId: number;
				imageUrl: string;
				price: number;
				isAvailable: boolean;
			}> = [];
			const skipped: Array<{ product_id: string; reason: string }> = [];

			for (const item of items) {
				const known = await getProduct(item.product_id);
				if (!known) {
					skipped.push({
						product_id: item.product_id,
						reason:
							"Unknown product id — not seen in any previous search. Search for it first, then add it using the id from those results.",
					});
					continue;
				}
				enriched.push({
					productId: item.product_id,
					quantity: item.quantity || 1,
					name: known.name,
					merchantId: known.merchantId,
					imageUrl: known.imageUrl ?? "",
					price: known.price,
					isAvailable: known.isAvailable ?? true,
				});
			}

			if (enriched.length === 0) {
				return fail(
					"None of the supplied product ids are known. Search for the products first, then add them using the ids returned by search.",
					{ skipped },
				);
			}

			const cartState = await addToCart(enriched);
			await persist();
			await syncCartToLocalStorage(cartState.items).catch(() => {});

			return ok({
				added: enriched.length,
				cart_total: cartState.totalPrice,
				items_count: cartState.totalQuantity,
				...(skipped.length > 0
					? {
							skipped,
							message: `${skipped.length} item(s) could not be added because their product ids are unknown.`,
						}
					: {}),
			});
		},
	);

	server.registerTool(
		"get_cart",
		{
			title: "View Cart",
			description: `Retrieve the current shopping cart contents. Returns each item's product_id, name, quantity, unit price, and line total, plus the cart subtotal and total item count.

Does not require login, but returns an empty cart if the user is not authenticated. Use this to show the user what's in their cart before proceeding to go_to_checkout.`,
			outputSchema: getCartOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			await hydrate();
			const cart = getCart();

			if (cart.items.length === 0) {
				return ok({ empty: true, items: [], total: 0 });
			}

			return ok({
				items: cart.items.map((item) => ({
					product_id: item.productId,
					name: item.name,
					qty: item.quantity,
					price: item.price,
					total: item.totalPrice,
				})),
				subtotal: cart.totalPrice,
				items_count: cart.totalQuantity,
			});
		},
	);

	server.registerTool(
		"remove_from_cart",
		{
			title: "Remove from Cart",
			description: `Remove a single product from the shopping cart entirely (sets its quantity to 0). Requires login. Syncs the change to both the server-side cart and the browser's localStorage.

Returns an updated summary with the new cart total and item count. To remove all items at once, use clear_cart instead. To change quantity without removing, use add_to_cart with the desired quantity.`,
			inputSchema: z.object({
				product_id: z
					.string()
					.min(1)
					.describe(
						"The product_id of the item to remove, from a previous get_cart or add_to_cart result",
					),
			}),
			outputSchema: cartSummaryOutput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ product_id }) => {
			if (!(await ensureAuthenticated())) return authRequired("modify cart");
			await hydrate();

			const cart = getCart();
			if (!cart.items.some((i) => i.productId === product_id)) {
				return fail(`Product "${product_id}" is not in the cart.`, {
					product_id,
				});
			}

			// Set quantity to 0 for the item to remove, keep others
			const allItems = cart.items
				.map((i) => ({
					productId: i.productId,
					quantity: i.productId === product_id ? 0 : i.quantity,
				}))
				.filter((i) => i.quantity > 0);

			const cartState = await syncCart(allItems);
			await persist();
			await syncCartToLocalStorage(cartState.items).catch(() => {});

			return ok({
				removed: product_id,
				cart_total: cartState.totalPrice,
				items_count: cartState.totalQuantity,
			});
		},
	);

	server.registerTool(
		"clear_cart",
		{
			title: "Clear Cart",
			description: `Remove ALL items from the shopping cart at once. This is a destructive operation — all items are set to quantity 0 and the cart is emptied. Requires login.

Use this when the user wants to start fresh or discard their current cart. To remove a single item, use remove_from_cart instead.`,
			outputSchema: cartSummaryOutput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			if (!(await ensureAuthenticated())) return authRequired("clear cart");
			await hydrate();

			const currentCart = getCart();

			if (currentCart.items.length === 0) {
				return ok({
					cleared: 0,
					cart_total: 0,
					items_count: 0,
					message: "Cart already empty.",
				});
			}

			await clearCartOnServer();
			await persist();
			await syncCartToLocalStorage([]).catch(() => {});

			return ok({
				cleared: currentCart.items.length,
				cart_total: 0,
				items_count: 0,
			});
		},
	);
}
