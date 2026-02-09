/**
 * Cart MCP Tools
 * add_to_cart, get_cart, remove_from_cart, clear_cart
 *
 * Mutation responses return summary only (total, count).
 * Use get_cart for the full item listing.
 *
 * After every cart mutation we sync to browser localStorage via
 * syncCartToLocalStorage(). Snoonu's Next.js frontend reads cart from
 * `marketplaceCartProducts` in localStorage.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { syncCart, getCart } from "../../lib/api-client";
import { isAuthenticated } from "../../lib/session-manager";
import { syncCartToLocalStorage } from "../../lib/browser";

function authError(action: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					error: true,
					message: `Must be logged in to ${action}. Call init_session first, then login.`,
				}),
			},
		],
	};
}

export function registerCartTools(server: McpServer) {
	server.tool(
		"add_to_cart",
		`Add one or more products to the Snoonu shopping cart. Accepts an array of {product_id, quantity} objects — use the product_id values from search_products, bulk_search, or search_in_merchant results.

Requires login (call init_session + login + verify_otp first). Syncs the cart both server-side (via the multicart API) and to the browser's localStorage so the Snoonu checkout page reflects changes immediately.

Returns a summary with items added, cart total, and item count. Use get_cart for the full item listing with per-item details. All items must be from merchants available at the current delivery location.`,
		{
			items: z
				.array(
					z.object({
						product_id: z
							.string()
							.describe("Product ID from search results"),
						quantity: z
							.number()
							.optional()
							.describe("Quantity to add (default: 1)"),
					}),
				)
				.describe("Array of items to add"),
		},
		async ({ items }) => {
			if (!isAuthenticated()) return authError("add items to cart");

			const cartState = await syncCart(
				items.map((item) => ({
					productId: item.product_id,
					quantity: item.quantity || 1,
				})),
			);

			await syncCartToLocalStorage(cartState.items);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							added: items.length,
							cart_total: cartState.totalPrice,
							items_count: cartState.totalQuantity,
						}),
					},
				],
			};
		},
	);

	server.tool(
		"get_cart",
		`Retrieve the current shopping cart contents from the Snoonu API. Returns each item's product_id, name, quantity, unit price, and line total, plus the cart subtotal and total item count.

Does not require login, but returns an empty cart if the user is not authenticated. Use this to show the user what's in their cart before proceeding to go_to_checkout.`,
		{},
		async () => {
			const cart = await getCart();

			if (cart.items.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								empty: true,
								items: [],
								total: 0,
							}),
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							items: cart.items.map((item) => ({
								product_id: item.productId,
								name: item.name,
								qty: item.quantity,
								price: item.price,
								total: item.totalPrice,
							})),
							subtotal: cart.totalPrice,
							items_count: cart.totalQuantity,
						}),
					},
				],
			};
		},
	);

	server.tool(
		"remove_from_cart",
		`Remove a single product from the shopping cart entirely (sets its quantity to 0). Requires login. Syncs the change to both the server-side cart and the browser's localStorage.

Returns an updated summary with the new cart total and item count. To remove all items at once, use clear_cart instead. To change quantity without removing, use add_to_cart with the desired quantity.`,
		{
			product_id: z
				.string()
				.describe("The product_id of the item to remove, from a previous get_cart or add_to_cart result"),
		},
		async ({ product_id }) => {
			if (!isAuthenticated()) return authError("modify cart");

			const cartState = await syncCart([
				{ productId: product_id, quantity: 0 },
			]);

			await syncCartToLocalStorage(cartState.items);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							removed: product_id,
							cart_total: cartState.totalPrice,
							items_count: cartState.totalQuantity,
						}),
					},
				],
			};
		},
	);

	server.tool(
		"clear_cart",
		`Remove ALL items from the shopping cart at once. This is a destructive operation — all items are set to quantity 0 and the cart is emptied. Requires login.

Use this when the user wants to start fresh or discard their current cart. To remove a single item, use remove_from_cart instead.`,
		{},
		async () => {
			if (!isAuthenticated()) return authError("clear cart");

			const currentCart = await getCart();

			if (currentCart.items.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ message: "Cart already empty." }),
						},
					],
				};
			}

			await syncCart(
				currentCart.items.map((item) => ({
					productId: item.productId,
					quantity: 0,
				})),
			);

			await syncCartToLocalStorage([]);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							cleared: currentCart.items.length,
							cart_total: 0,
							items_count: 0,
						}),
					},
				],
			};
		},
	);
}
