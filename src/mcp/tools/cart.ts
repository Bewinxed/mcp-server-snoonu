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
		"Add one or more products to the shopping cart. Use product_id from search results. Requires login. Returns summary — use get_cart for full listing.",
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
		"Get current shopping cart contents. Shows all items, quantities, and prices.",
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
		"Remove an item from the cart. Returns updated summary — use get_cart for full listing.",
		{
			product_id: z
				.string()
				.describe("Product ID to remove from cart"),
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
		"Remove all items from the cart.",
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
