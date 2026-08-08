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
 *
 * Product metadata discovered here is written to the persistent store
 * (../lib/store) rather than a module-level Map, so that a product id handed to
 * the model in one process still resolves in the next. Snoonu has no
 * fetch-by-id endpoint, so remembering is the only way to resolve an id later.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	searchProducts,
	searchInMerchant,
	type CategoryName,
	type ProductResult,
	type MerchantResult,
} from "../../lib/api-client";
import { ok, fail } from "../lib/result";
import { putProducts, getProduct, type ProductRecord } from "../lib/store";

const CATEGORIES = [
	"Groceries",
	"Restaurants",
	"Pharmacy",
	"Market",
	"Flowers",
] as const;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function toRecord(
	p: ProductResult,
	merchantName: string,
	menuId?: number,
): ProductRecord {
	return {
		productId: p.productId,
		name: p.name,
		price: p.price,
		merchantId: p.merchantId,
		merchantName,
		menuId,
		imageUrl: p.imageUrl ?? undefined,
		description: p.description ?? undefined,
		isInStock: p.isInStock,
		isAvailable: p.isAvailable,
		stockCount: p.stockCount,
		originalPrice: p.originalPrice ?? undefined,
		discountPercentage: p.discountPercentage ?? undefined,
	};
}

/** Persist every product from a set of merchants in one batched write. */
async function cacheMerchants(merchants: MerchantResult[]): Promise<void> {
	const records: ProductRecord[] = [];
	for (const m of merchants) {
		for (const p of m.products) records.push(toRecord(p, m.name, m.menuId));
	}
	await putProducts(records);
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
// Output schemas
// ---------------------------------------------------------------------------

const productOptionSchema = z.object({
	id: z.string(),
	name: z.string(),
	price: z.number(),
	merchant: z.string().optional(),
	merchant_id: z.number().optional(),
	menu_id: z.number().optional(),
	eta: z.number().optional(),
	free_delivery: z.boolean().optional(),
	discount: z.number().optional(),
});

const searchProductsOutput = z.object({
	query: z.string(),
	merchants: z.number(),
	cheapest: z.array(productOptionSchema),
	merchant_summaries: z.array(z.record(z.string(), z.unknown())).optional(),
	merchant_details: z.array(z.record(z.string(), z.unknown())).optional(),
	hint: z.string().optional(),
});

const bulkSearchOutput = z.object({
	queries: z.number(),
	total_found: z.number(),
	results: z.array(
		z.object({
			query: z.string(),
			found: z.number(),
			options: z.array(productOptionSchema),
			error: z.string().optional(),
		}),
	),
	hint: z.string().optional(),
});

const searchInMerchantOutput = z.object({
	query: z.string(),
	merchant_id: z.number(),
	products: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			price: z.number(),
			discount: z.number().optional(),
		}),
	),
	hint: z.string().optional(),
});

const productDetailsOutput = z.object({
	id: z.string(),
	name: z.string(),
	price: z.number(),
	merchant: z.string().optional(),
	merchant_id: z.number().optional(),
	menu_id: z.number().optional(),
	in_stock: z.boolean().optional(),
	original_price: z.number().optional(),
	discount: z.number().optional(),
	image_url: z.string().optional(),
	description: z.string().optional(),
	stock_count: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSearchTools(server: McpServer) {
	// ── search_products ────────────────────────────────────────────────
	server.registerTool(
		"search_products",
		{
			title: "Search Products",
			description: `Search for products across all open Snoonu merchants. Best for single-item queries like "milk" or "chicken breast". For grocery lists with multiple items, use bulk_search instead — it runs queries in parallel and is much faster.

Returns two things: (1) merchant summaries with name, ETA, rating, delivery info, and price range; (2) the cheapest matching products across all merchants, sorted by price. Does not require login — works for anonymous browsing.

Use response_format to control token cost:
  - "concise" (default): merchant summaries + top cheapest products globally. ~65% fewer tokens.
  - "detailed": includes per-merchant product lists for side-by-side price comparison.

Set deep_search=true to fan out into each merchant's full catalog via search_in_merchant. This is slower (one extra API call per merchant) but finds products that the global search may miss.

Next steps after searching: use search_in_merchant(merchant_id, menu_id, query) to see a specific merchant's full results, or get_product_details(product_id) for images, stock count, and descriptions.`,
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("Search term (e.g. 'milk', 'chicken breast', 'rice')"),
				category: z
					.enum(CATEGORIES)
					.optional()
					.describe("Product category (default: Groceries)"),
				limit: z
					.number()
					.int()
					.positive()
					.max(50)
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
			}),
			outputSchema: searchProductsOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
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
				return ok({
					query,
					merchants: 0,
					cheapest: [],
					hint: `No open merchants found for "${query}". Try broader terms or a different category.`,
				});
			}

			// Deep search: fan out into each merchant
			if (deep_search) {
				openMerchants = await chunkParallel(openMerchants, 5, async (merchant) => {
					try {
						const deepProducts = await searchInMerchant(
							merchant.id,
							merchant.menuId,
							query,
						);
						return {
							...merchant,
							products:
								deepProducts.length > 0 ? deepProducts : merchant.products,
						};
					} catch {
						return merchant;
					}
				});
			}

			// Persist so these ids resolve in later processes
			await cacheMerchants(openMerchants);

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
						...(p.discountPercentage ? { discount: p.discountPercentage } : {}),
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
				return ok({
					query,
					merchants: merchantSummaries.length,
					cheapest,
					merchant_summaries: merchantSummaries,
					hint: "Use search_in_merchant(merchant_id, menu_id, query) for full product lists. Use get_product_details(product_id) for images/stock.",
				});
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

			return ok({
				query,
				merchants: merchantDetails.length,
				cheapest,
				merchant_details: merchantDetails,
			});
		},
	);

	// ── bulk_search ───────────────────────────────────────────────────
	server.registerTool(
		"bulk_search",
		{
			title: "Bulk Search Products",
			description: `Search for multiple products at once, running all queries in parallel. Use this instead of calling search_products repeatedly — it is significantly faster for grocery lists or multi-item requests.

For each query, returns the top results across all open merchants sorted by price, including merchant name, ETA, and free delivery status so you can compare options and recommend the best one. Example input: ["milk", "eggs", "bread", "chicken breast"].

Optionally pass merchant_ids to restrict results to specific stores (useful after an initial search_products identifies preferred merchants). Set deep_search=true to fan out into each merchant per query for comprehensive results — slower but finds items the global search may miss.

Does not require login. Returns up to top_k results per query (default 5). Use get_product_details(product_id) on any result for images, stock, and descriptions.`,
			inputSchema: z.object({
				queries: z
					.array(z.string().min(1))
					.min(1)
					.max(20)
					.describe('List of search terms (e.g. ["milk", "eggs", "bread"])'),
				category: z
					.enum(CATEGORIES)
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
					.int()
					.positive()
					.max(50)
					.optional()
					.describe(
						"Number of top results to return per query across all merchants (default: 5)",
					),
			}),
			outputSchema: bulkSearchOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		async ({ queries, category, deep_search, top_k, merchant_ids }) => {
			const cat = (category as CategoryName) || "Groceries";
			const topK = top_k || 5;
			const merchantFilter = merchant_ids ? new Set(merchant_ids) : null;

			const queryResults = await chunkParallel(queries, 5, async (query) => {
				try {
					const result = await searchProducts(query, {
						category: cat,
						productSize: topK,
					});

					let openMerchants = result.merchants.filter(
						(m) => m.isOpen && (!merchantFilter || merchantFilter.has(m.id)),
					);

					if (deep_search && openMerchants.length > 0) {
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

					await cacheMerchants(openMerchants);

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

					return { query, found: options.length, options };
				} catch (err) {
					return {
						query,
						found: 0,
						options: [],
						error: err instanceof Error ? err.message : String(err),
					};
				}
			});

			const totalFound = queryResults.reduce((sum, r) => sum + r.found, 0);

			return ok({
				queries: queries.length,
				total_found: totalFound,
				results: queryResults,
				hint: "Compare options per query — pick by price, ETA, or merchant preference. Use get_product_details(id) for images/stock.",
			});
		},
	);

	// ── search_in_merchant ─────────────────────────────────────────────
	server.registerTool(
		"search_in_merchant",
		{
			title: "Search Within Merchant",
			description: `Search within a single merchant's full catalog. Use the merchant_id and menu_id values from a previous search_products or bulk_search result.

Returns a compact list of matching products (id, name, price, discount) from that merchant only. This is more thorough than the global search for a specific store — it queries the merchant's own search index and often returns products that search_products missed.

Does not require login. Use get_product_details(product_id) on any result for images, descriptions, and stock info.`,
			inputSchema: z.object({
				merchant_id: z
					.number()
					.describe("Merchant ID from search_products results"),
				menu_id: z.number().describe("Menu ID from search_products results"),
				query: z.string().min(1).describe("Search term within this merchant"),
			}),
			outputSchema: searchInMerchantOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		async ({ merchant_id, menu_id, query }) => {
			const products = await searchInMerchant(merchant_id, menu_id, query);

			// Persist. Prefer a merchant name we already know over the placeholder.
			const records = await Promise.all(
				products.map(async (p) => {
					const known = await getProduct(p.productId);
					return toRecord(
						p,
						known?.merchantName ?? `merchant_${merchant_id}`,
						menu_id,
					);
				}),
			);
			await putProducts(records);

			if (products.length === 0) {
				return ok({
					query,
					merchant_id,
					products: [],
					hint: `No results for "${query}" in this merchant. Try broader terms or search_products for other merchants.`,
				});
			}

			return ok({
				query,
				merchant_id,
				products: products.map(compactProduct),
				hint: "Use get_product_details(id) for images, descriptions, and stock info.",
			});
		},
	);

	// ── get_product_details ────────────────────────────────────────────
	server.registerTool(
		"get_product_details",
		{
			title: "Get Product Details",
			description: `Get full details for a single product by its product_id. Returns image URL, description, stock count, original price, discount percentage, and availability — fields that are omitted from search results to save tokens.

The product must have been seen in a previous search (results are remembered on disk across restarts). If it is unknown, search for it first with search_products or search_in_merchant.`,
			inputSchema: z.object({
				product_id: z.string().min(1).describe("Product ID from search results"),
			}),
			outputSchema: productDetailsOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		async ({ product_id }) => {
			const cached = await getProduct(product_id);

			if (!cached) {
				return fail(
					`Product "${product_id}" is not known. Search for it first with search_products or search_in_merchant, then retry with an id from those results.`,
					{ product_id },
				);
			}

			const detail: Record<string, unknown> = {
				id: cached.productId,
				name: cached.name,
				price: cached.price,
				merchant: cached.merchantName,
				merchant_id: cached.merchantId,
				in_stock: cached.isInStock,
			};

			if (cached.menuId !== undefined) detail.menu_id = cached.menuId;
			if (cached.originalPrice) detail.original_price = cached.originalPrice;
			if (cached.discountPercentage) detail.discount = cached.discountPercentage;
			if (cached.imageUrl) detail.image_url = cached.imageUrl;
			if (cached.description) detail.description = cached.description;
			if (cached.stockCount && cached.stockCount > 0) {
				detail.stock_count = cached.stockCount;
			}

			return ok(detail);
		},
	);
}
