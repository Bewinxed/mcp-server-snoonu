// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Search MCP Tools
 *
 * Three-tier progressive disclosure:
 *   1. search_products  — merchant summaries + top N cheapest (concise by default)
 *   2. search_in_merchant — compact product list for one merchant
 *   3. get_product_details — full detail for a single product (image, stock, description)
 *
 * Design principles (per Anthropic's tool-building guidance):
 *   - Return the minimum tokens needed for the agent's next decision
 *   - Strip nulls, omit image URLs except in detail view
 *   - Include actionable hints steering toward drill-down tools
 *   - response_format param for concise (~65% fewer tokens) vs detailed
 *   - Error messages are actionable guidance, not opaque failures
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	searchProducts,
	searchInMerchant,
	type CategoryName,
	type ProductResult,
	type MerchantResult,
} from "../../lib/api-client";

// ---------------------------------------------------------------------------
// In-memory product cache — populated by every search, read by get_product_details
// ---------------------------------------------------------------------------
const productCache = new Map<
	string,
	ProductResult & { merchantName: string }
>();

function cacheProducts(merchant: MerchantResult) {
	for (const p of merchant.products) {
		productCache.set(p.productId, { ...p, merchantName: merchant.name });
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function chunkParallel<T, R>(
	items: T[],
	size: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += size) {
		const chunk = items.slice(i, i + size);
		const chunkResults = await Promise.all(chunk.map(fn));
		results.push(...chunkResults);
	}
	return results;
}

/** Build a compact product object — only non-null fields */
function compactProduct(p: ProductResult) {
	const out: Record<string, unknown> = {
		id: p.productId,
		name: p.name,
		price: p.price,
	};
	if (p.discountPercentage) out.discount = p.discountPercentage;
	return out;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSearchTools(server: McpServer) {
	// ── search_products ────────────────────────────────────────────────
	server.tool(
		"search_products",
		`Search for products across all open Snoonu merchants. Best for single-item queries like "milk" or "chicken breast". For grocery lists with multiple items, use bulk_search instead — it runs queries in parallel and is much faster.

Returns two things: (1) merchant summaries with name, ETA, rating, delivery info, and price range; (2) the cheapest matching products across all merchants, sorted by price. Does not require login — works for anonymous browsing.

Use response_format to control token cost:
  - "concise" (default): merchant summaries + top cheapest products globally. ~65% fewer tokens.
  - "detailed": includes per-merchant product lists for side-by-side price comparison.

Set deep_search=true to fan out into each merchant's full catalog via search_in_merchant. This is slower (one extra API call per merchant) but finds products that the global search may miss.

Next steps after searching: use search_in_merchant(merchant_id, menu_id, query) to see a specific merchant's full results, or get_product_details(product_id) for images, stock count, and descriptions.`,
		{
			query: z
				.string()
				.describe("Search term (e.g. 'milk', 'chicken breast', 'rice')"),
			category: z
				.enum(["Groceries", "Restaurants", "Pharmacy", "Market", "Flowers"])
				.optional()
				.describe("Product category (default: Groceries)"),
			limit: z
				.number()
				.optional()
				.describe("Max products per merchant (default: 5)"),
			deep_search: z
				.boolean()
				.optional()
				.describe(
					"Fan out into each merchant for full catalogs. Slower but finds more items and cheaper options. (default: false)",
				),
			response_format: z
				.enum(["concise", "detailed"])
				.optional()
				.describe(
					"'concise' (default): merchant summaries + top cheapest. 'detailed': per-merchant product lists.",
				),
		},
		async ({ query, category, limit, deep_search, response_format }) => {
			const cat = (category as CategoryName) || "Groceries";
			const lim = limit || 5;
			const format = response_format || "concise";

			const result = await searchProducts(query, {
				category: cat,
				productSize: lim,
			});

			let openMerchants = result.merchants.filter((m) => m.isOpen);

			if (openMerchants.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								query,
								merchants: 0,
								cheapest: [],
								hint: `No open merchants found for "${query}". Try broader terms or a different category.`,
							}),
						},
					],
				};
			}

			// Deep search: fan out into each merchant
			if (deep_search) {
				openMerchants = await chunkParallel(
					openMerchants,
					5,
					async (merchant) => {
						try {
							const deepProducts = await searchInMerchant(
								merchant.id,
								merchant.menuId,
								query,
							);
							return {
								...merchant,
								products:
									deepProducts.length > 0
										? deepProducts
										: merchant.products,
							};
						} catch {
							return merchant;
						}
					},
				);
			}

			// Populate cache
			for (const m of openMerchants) cacheProducts(m);

			// Build merchant summaries
			const merchantSummaries = openMerchants.map((m) => {
				const prices = m.products.map((p) => p.price).filter(Boolean);
				const min = Math.min(...prices);
				const max = Math.max(...prices);
				return {
					name: m.name,
					id: m.id,
					menu_id: m.menuId,
					eta: m.minEta,
					rating: m.rating,
					free_delivery: m.isFreeDeliveryEligible,
					products: m.products.length,
					price_range:
						prices.length > 0
							? min === max
								? `${min.toFixed(2)}`
								: `${min.toFixed(2)}-${max.toFixed(2)}`
							: null,
				};
			});

			// Global cheapest products (deduplicated by productId, sorted by price)
			const seen = new Set<string>();
			const cheapest = openMerchants
				.flatMap((m) =>
					m.products.slice(0, lim).map((p) => ({
						id: p.productId,
						name: p.name,
						price: p.price,
						merchant: m.name,
						merchant_id: m.id,
						menu_id: m.menuId,
						...(p.discountPercentage
							? { discount: p.discountPercentage }
							: {}),
					})),
				)
				.filter((p) => {
					if (seen.has(p.id)) return false;
					seen.add(p.id);
					return true;
				})
				.sort((a, b) => a.price - b.price)
				.slice(0, lim * 3);

			if (format === "concise") {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								query,
								merchants: merchantSummaries.length,
								cheapest,
								merchant_summaries: merchantSummaries,
								hint: "Use search_in_merchant(merchant_id, menu_id, query) for full product lists. Use get_product_details(product_id) for images/stock.",
							}),
						},
					],
				};
			}

			// Detailed: include per-merchant product lists (compact)
			const merchantDetails = openMerchants.map((m) => {
				const sorted = [...m.products]
					.sort((a, b) => a.price - b.price)
					.slice(0, lim);
				return {
					name: m.name,
					id: m.id,
					menu_id: m.menuId,
					eta: m.minEta,
					rating: m.rating,
					free_delivery: m.isFreeDeliveryEligible,
					products: sorted.map(compactProduct),
				};
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							query,
							merchants: merchantDetails.length,
							cheapest,
							merchant_details: merchantDetails,
						}),
					},
				],
			};
		},
	);

	// ── bulk_search ───────────────────────────────────────────────────
	server.tool(
		"bulk_search",
		`Search for multiple products at once, running all queries in parallel. Use this instead of calling search_products repeatedly — it is significantly faster for grocery lists or multi-item requests.

For each query, returns the top results across all open merchants sorted by price, including merchant name, ETA, and free delivery status so you can compare options and recommend the best one. Example input: ["milk", "eggs", "bread", "chicken breast"].

Optionally pass merchant_ids to restrict results to specific stores (useful after an initial search_products identifies preferred merchants). Set deep_search=true to fan out into each merchant per query for comprehensive results — slower but finds items the global search may miss.

Does not require login. Returns up to top_k results per query (default 5). Use get_product_details(product_id) on any result for images, stock, and descriptions.`,
		{
			queries: z
				.array(z.string())
				.min(1)
				.max(20)
				.describe(
					'List of search terms (e.g. ["milk", "eggs", "bread"])',
				),
			category: z
				.enum([
					"Groceries",
					"Restaurants",
					"Pharmacy",
					"Market",
					"Flowers",
				])
				.optional()
				.describe("Product category for all queries (default: Groceries)"),
			merchant_ids: z
				.array(z.number())
				.optional()
				.describe(
					"Filter to specific merchant IDs (from previous search_products results). If omitted, searches all merchants.",
				),
			deep_search: z
				.boolean()
				.optional()
				.describe(
					"Fan out into each merchant per query. Slower but finds more options. (default: false)",
				),
			top_k: z
				.number()
				.optional()
				.describe(
					"Number of top results to return per query across all merchants (default: 5)",
				),
		},
		async ({ queries, category, deep_search, top_k, merchant_ids }) => {
			const cat = (category as CategoryName) || "Groceries";
			const topK = top_k || 5;
			const merchantFilter = merchant_ids
				? new Set(merchant_ids)
				: null;

			const queryResults = await chunkParallel(
				queries,
				5,
				async (query) => {
					try {
						const result = await searchProducts(query, {
							category: cat,
							productSize: topK,
						});

						let openMerchants = result.merchants.filter(
							(m) =>
								m.isOpen &&
								(!merchantFilter || merchantFilter.has(m.id)),
						);

						if (deep_search && openMerchants.length > 0) {
							openMerchants = await chunkParallel(
								openMerchants,
								5,
								async (merchant) => {
									try {
										const deepProducts =
											await searchInMerchant(
												merchant.id,
												merchant.menuId,
												query,
											);
										return {
											...merchant,
											products:
												deepProducts.length > 0
													? deepProducts
													: merchant.products,
										};
									} catch {
										return merchant;
									}
								},
							);
						}

						for (const m of openMerchants) cacheProducts(m);

						// Collect all products with merchant context, dedup by productId
						const seen = new Set<string>();
						const options = openMerchants
							.flatMap((m) =>
								m.products.map((p) => ({
									id: p.productId,
									name: p.name,
									price: p.price,
									merchant: m.name,
									merchant_id: m.id,
									menu_id: m.menuId,
									eta: m.minEta,
									free_delivery: m.isFreeDeliveryEligible,
									...(p.discountPercentage
										? { discount: p.discountPercentage }
										: {}),
								})),
							)
							.filter((p) => {
								if (seen.has(p.id)) return false;
								seen.add(p.id);
								return true;
							})
							.sort((a, b) => a.price - b.price)
							.slice(0, topK);

						return {
							query,
							found: options.length,
							options,
						};
					} catch (err) {
						return {
							query,
							found: 0,
							options: [],
							error:
								err instanceof Error
									? err.message
									: String(err),
						};
					}
				},
			);

			const totalFound = queryResults.reduce(
				(sum, r) => sum + r.found,
				0,
			);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							queries: queries.length,
							total_found: totalFound,
							results: queryResults,
							hint: "Compare options per query — pick by price, ETA, or merchant preference. Use get_product_details(id) for images/stock.",
						}),
					},
				],
			};
		},
	);

	// ── search_in_merchant ─────────────────────────────────────────────
	server.tool(
		"search_in_merchant",
		`Search within a single merchant's full catalog. Use the merchant_id and menu_id values from a previous search_products or bulk_search result.

Returns a compact list of matching products (id, name, price, discount) from that merchant only. This is more thorough than the global search for a specific store — it queries the merchant's own search index and often returns products that search_products missed.

Does not require login. Use get_product_details(product_id) on any result for images, descriptions, and stock info.`,
		{
			merchant_id: z
				.number()
				.describe("Merchant ID from search_products results"),
			menu_id: z.number().describe("Menu ID from search_products results"),
			query: z.string().describe("Search term within this merchant"),
		},
		async ({ merchant_id, menu_id, query }) => {
			const products = await searchInMerchant(merchant_id, menu_id, query);

			// Cache results
			for (const p of products) {
				productCache.set(p.productId, {
					...p,
					merchantName: `merchant_${merchant_id}`,
				});
			}

			if (products.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								query,
								merchant_id,
								products: [],
								hint: `No results for "${query}" in this merchant. Try broader terms or search_products for other merchants.`,
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
							query,
							merchant_id,
							products: products.map(compactProduct),
							hint: "Use get_product_details(id) for images, descriptions, and stock info.",
						}),
					},
				],
			};
		},
	);

	// ── get_product_details ────────────────────────────────────────────
	server.tool(
		"get_product_details",
		`Get full details for a single product by its product_id. Returns image URL, description, stock count, original price, discount percentage, and availability — fields that are omitted from search results to save tokens.

The product must have appeared in a previous search_products, bulk_search, or search_in_merchant call during this session (results are cached in memory). If the product is not in cache, you will get an error asking you to search for it first.

Use this when the user wants to see what a product looks like, check if it's in stock, or read its description before adding to cart.`,
		{
			product_id: z
				.string()
				.describe("Product ID from search results"),
		},
		async ({ product_id }) => {
			const cached = productCache.get(product_id);

			if (!cached) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: true,
								message: `Product "${product_id}" not in cache. Search for it first with search_products or search_in_merchant.`,
							}),
						},
					],
				};
			}

			const detail: Record<string, unknown> = {
				id: cached.productId,
				name: cached.name,
				price: cached.price,
				merchant: cached.merchantName,
				merchant_id: cached.merchantId,
				in_stock: cached.isInStock,
			};

			if (cached.originalPrice) detail.original_price = cached.originalPrice;
			if (cached.discountPercentage) detail.discount = cached.discountPercentage;
			if (cached.imageUrl) detail.image_url = cached.imageUrl;
			if (cached.description) detail.description = cached.description;
			if (cached.stockCount > 0) detail.stock_count = cached.stockCount;

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(detail),
					},
				],
			};
		},
	);
}
