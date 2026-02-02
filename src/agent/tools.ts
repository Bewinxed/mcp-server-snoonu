/**
 * Snoonu Shopping Agent Tools
 * Custom MCP server with Snoonu shopping tools for the Agent SDK
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
	SnoonuClient,
	getSnoonuClient,
	SNOONU_CATEGORIES,
	type CategoryName,
	type ProductResult,
	type MerchantResult,
	type CartState,
} from "../lib/snoonu";

// Store client instance for tool handlers
let snoonuClient: SnoonuClient | null = null;

/**
 * Get or initialize the Snoonu client
 */
async function getClient(): Promise<SnoonuClient> {
	if (!snoonuClient) {
		snoonuClient = await getSnoonuClient();
	}
	return snoonuClient;
}

/**
 * Tool: Initialize browser session for Snoonu shopping
 */
const initSessionTool = tool(
	"init_session",
	"Initialize browser session for Snoonu shopping. Call this first to set up the shopping session. Returns whether user is logged in and the session ID.",
	{},
	async () => {
		try {
			const client = await getClient();
			const { loggedIn, sessionId } = await client.initialize();

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								success: true,
								logged_in: loggedIn,
								session_id: sessionId,
								message: loggedIn
									? "Session initialized. User is logged in."
									: "Session initialized. User is NOT logged in. Use request_otp to start login.",
							},
							null,
							2
						),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
							message:
								"Failed to initialize session. Make sure Chrome is running with remote debugging enabled on port 9111.",
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Request OTP for login
 */
const requestOtpTool = tool(
	"request_otp",
	"Start login by sending OTP to phone number. User must be NOT logged in. After calling this, ask the user for the OTP code they received.",
	{
		phone_number: z
			.string()
			.describe("Phone number without country code (e.g., '55123456')"),
	},
	async ({ phone_number }) => {
		try {
			const client = await getClient();

			// Check if already logged in
			if (await client.isLoggedIn()) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message: "User is already logged in. No need to request OTP.",
							}),
						},
					],
				};
			}

			const result = await client.requestOtp(phone_number);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							message: result.message,
							next_step: result.success
								? "Ask the user for the 6-digit OTP code they received, then call verify_otp"
								: "Check the error and try again",
						}),
					},
				],
				isError: !result.success,
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Verify OTP code
 */
const verifyOtpTool = tool(
	"verify_otp",
	"Complete login by verifying OTP code. Call this after request_otp with the code the user received.",
	{
		otp_code: z
			.string()
			.length(6)
			.describe("6-digit OTP code received by the user"),
	},
	async ({ otp_code }) => {
		try {
			const client = await getClient();
			const result = await client.verifyOtp(otp_code);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							logged_in: result.loggedIn,
							message: result.message,
						}),
					},
				],
				isError: !result.success,
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							logged_in: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Search for products
 */
const searchProductsTool = tool(
	"search_products",
	"Search for products across Snoonu merchants. Returns products sorted by price and relevance with merchant information.",
	{
		query: z.string().describe("Search term (e.g., 'milk', 'chicken breast', 'rice')"),
		category: z
			.enum(["Groceries", "Restaurants", "Pharmacy", "Market", "Flowers"])
			.optional()
			.default("Groceries")
			.describe("Product category to search in"),
		limit: z
			.number()
			.optional()
			.default(10)
			.describe("Maximum number of products to return per merchant"),
	},
	async ({ query, category, limit }) => {
		try {
			const client = await getClient();
			const result = await client.searchProducts(query, {
				category: category as CategoryName,
				productSize: limit,
			});

			// Flatten and sort products by price
			const allProducts: Array<ProductResult & { merchantName: string; merchantId: number }> = [];

			for (const merchant of result.merchants) {
				if (!merchant.isOpen) continue;

				for (const product of merchant.products.slice(0, limit)) {
					allProducts.push({
						...product,
						merchantName: merchant.name,
						merchantId: merchant.id,
					});
				}
			}

			// Sort by relevance and price (prioritize exact matches and lower prices)
			allProducts.sort((a, b) => {
				const relevanceDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
				if (Math.abs(relevanceDiff) > 0.2) return relevanceDiff;
				return a.price - b.price;
			});

			// Format for output
			const formattedProducts = allProducts.slice(0, limit * 3).map((p) => ({
				product_id: p.productId,
				name: p.name,
				price: p.price,
				original_price: p.originalPrice,
				discount_percentage: p.discountPercentage,
				merchant: p.merchantName,
				merchant_id: p.merchantId,
				in_stock: p.isInStock,
				image_url: p.imageUrl,
				relevance_score: p.relevanceScore,
			}));

			const merchantSummary = result.merchants
				.filter((m) => m.isOpen)
				.slice(0, 5)
				.map((m) => ({
					name: m.name,
					id: m.id,
					eta_minutes: m.minEta,
					rating: m.rating,
					free_delivery: m.isFreeDeliveryEligible,
					product_count: m.products.length,
				}));

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								success: true,
								query,
								total_products: formattedProducts.length,
								merchants_found: merchantSummary.length,
								products: formattedProducts,
								merchants: merchantSummary,
							},
							null,
							2
						),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							query,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Add products to cart
 */
const addToCartTool = tool(
	"add_to_cart",
	"Add one or more products to the shopping cart. Use product_id from search results.",
	{
		items: z
			.array(
				z.object({
					product_id: z.string().describe("Product ID from search results"),
					quantity: z
						.number()
						.optional()
						.default(1)
						.describe("Quantity to add (default: 1)"),
				})
			)
			.describe("Array of items to add to cart"),
	},
	async ({ items }) => {
		try {
			const client = await getClient();

			// Check if logged in
			if (!(await client.isLoggedIn())) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message:
									"User must be logged in to add items to cart. Use request_otp to start login.",
							}),
						},
					],
					isError: true,
				};
			}

			const cartState = await client.addToCart(
				items.map((item) => ({
					productId: item.product_id,
					quantity: item.quantity,
				}))
			);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
							cart_total: cartState.totalPrice,
							items_count: cartState.totalQuantity,
							items_added: items.length,
							cart_items: cartState.items.map((item) => ({
								product_id: item.productId,
								name: item.name,
								quantity: item.quantity,
								price: item.price,
								total: item.totalPrice,
							})),
						}),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Get current cart contents
 */
const getCartTool = tool(
	"get_cart",
	"Get current shopping cart contents and total. Shows all items, quantities, and prices.",
	{},
	async () => {
		try {
			const client = await getClient();
			const cart = await client.getCart();

			if (cart.items.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: true,
								empty: true,
								message: "Cart is empty",
								items: [],
								total: 0,
								items_count: 0,
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
							success: true,
							empty: false,
							items: cart.items.map((item) => ({
								product_id: item.productId,
								name: item.name,
								quantity: item.quantity,
								unit_price: item.price,
								total_price: item.totalPrice,
								available: item.isAvailable,
							})),
							subtotal: cart.totalPrice,
							items_count: cart.totalQuantity,
							// Note: delivery fee is calculated at checkout
							estimated_delivery_fee: 10, // Default fee in QAR
						}),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Tool: Go to checkout
 */
const checkoutTool = tool(
	"checkout",
	"Navigate to checkout page. Does NOT place the order - just navigates to checkout where the user can review and complete their purchase.",
	{},
	async () => {
		try {
			const client = await getClient();

			// Check if logged in
			if (!(await client.isLoggedIn())) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message:
									"User must be logged in to checkout. Use request_otp to start login.",
							}),
						},
					],
					isError: true,
				};
			}

			const result = await client.goToCheckout();

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							checkout_url: result.checkoutUrl,
							summary: result.summary,
							message: result.success
								? "Navigated to checkout. User can now review and complete their order."
								: "Failed to navigate to checkout",
						}),
					},
				],
				isError: !result.success,
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: false,
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					},
				],
				isError: true,
			};
		}
	}
);

/**
 * Create the Snoonu MCP Server with all tools
 */
export const snoonuMcpServer = createSdkMcpServer({
	name: "snoonu-shopping",
	version: "1.0.0",
	tools: [
		initSessionTool,
		requestOtpTool,
		verifyOtpTool,
		searchProductsTool,
		addToCartTool,
		getCartTool,
		checkoutTool,
	],
});

/**
 * Export individual tools for testing
 */
export const tools = {
	initSession: initSessionTool,
	requestOtp: requestOtpTool,
	verifyOtp: verifyOtpTool,
	searchProducts: searchProductsTool,
	addToCart: addToCartTool,
	getCart: getCartTool,
	checkout: checkoutTool,
};

export default snoonuMcpServer;
