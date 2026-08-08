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
 * the model in one process still resolves in the next. Products can also be
 * fetched live via GET /api/v7/products/{id}?branch_id={branch_id} when the
 * store misses and a branch_id is available.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	searchProducts,
	searchInMerchant,
	searchMarket,
	fetchProductById,
	type CategoryName,
	type ProductResult,
	type MerchantResult,
} from "../../lib/api-client";
import { ok, fail } from "../lib/result";
import { putProducts, getProduct, type ProductRecord } from "../lib/store";

const CATEGORIES = [
	"Restaurants",
	"Groceries",
	"Pharmacy",
	"Flowers & Gifts",
	"Charity",
	"Tamwin",
	"Services",
	// Market is NOT a /v5/search/global category — it routes to Snoomarket.
	"Market",
] as const;

/**
 * Market lives on a different host and has no merchant/branch layer, so it is
 * handled by searchMarket() and returned as a flat product list.
 */
async function marketSearch(
	query: string,
	limit: number,
): Promise<{ products: ProductResult[]; records: ProductRecord[] }> {
	const products = await searchMarket(query, { pageSize: Math.max(limit, 20) });
	const records: ProductRecord[] = products.map((p) => ({
		productId: p.productId,
		name: p.name,
		price: p.price,
		merchantId: p.merchantId,
		merchantName: "Snoonu Market",
		// Marketplace products resolve via /v7/products with an empty branch_id.
		branchId: "",
		imageUrl: p.imageUrl ?? undefined,
		description: p.description ?? undefined,
		isInStock: p.isInStock,
		isAvailable: p.isAvailable,
		stockCount: p.stockCount,
		originalPrice: p.originalPrice ?? undefined,
		discountPercentage: p.discountPercentage ?? undefined,
	}));
	await putProducts(records);
	return { products, records };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function toRecord(
	p: ProductResult,
	merchantName: string,
	branchId?: string,
): ProductRecord {
	return {
		productId: p.productId,
		name: p.name,
		price: p.price,
		merchantId: p.merchantId,
		merchantName,
		branchId,
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
		for (const p of m.products) records.push(toRecord(p, m.name, m.branchId));
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
	branch_id: z.string().optional(),
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
	branch_id: z.string(),
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
	branch_id: z.string().optional(),
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

Next steps after searching: use search_in_merchant(branch_id, query) to see a specific merchant's full results, or get_product_details(product_id) for images, stock count, and descriptions.`,
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("Search term (e.g. 'milk', 'chicken breast', 'rice')"),
				category: z
					.enum(CATEGORIES)
					.optional()
					.describe("Product category to filter by. Omit to search all categories."),
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
			const lim = limit || 5;
			const format = response_format || "concise";

			// Market is a separate vertical with no merchant layer.
			if (category === "Market") {
				const { products } = await marketSearch(query, lim);
				if (products.length === 0) {
					return ok({
						query,
						merchants: 0,
						cheapest: [],
						hint: `No Snoonu Market results for "${query}". Try broader terms, or omit the category to search all verticals.`,
					});
				}
				const cheapest = [...products]
					.sort((a, b) => a.price - b.price)
					.slice(0, lim * 3)
					.map((p) => ({
						id: p.productId,
						name: p.name,
						price: p.price,
						merchant: "Snoonu Market",
						merchant_id: p.merchantId,
						...(p.discountPercentage ? { discount: p.discountPercentage } : {}),
					}));
				return ok({
					query,
					merchants: new Set(products.map((p) => p.merchantId)).size,
					cheapest,
					hint: "Snoonu Market results. Use get_product_details(product_id) for images and stock.",
				});
			}

			const cat = category as CategoryName | undefined;

			const result = await searchProducts(query, {
				category: cat,
				productSize: lim,
			});

			let openMerchants = result.merchants.filter(
				(m) => m.isOpen || m.acceptsScheduledOrders,
			);

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
							merchant.branchId,
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
					branch_id: m.branchId,
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
						branch_id: m.branchId,
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
					hint: "Use search_in_merchant(branch_id, query) for full product lists. Use get_product_details(product_id) for images/stock.",
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
					branch_id: m.branchId,
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
					.describe("Product category for all queries. Omit to search all categories."),
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
			const cat = category as CategoryName | undefined;
			const topK = top_k || 5;
			const merchantFilter = merchant_ids ? new Set(merchant_ids) : null;
			const isMarket = category === "Market";

			const queryResults = await chunkParallel(queries, 5, async (query) => {
				try {
					// Market is a separate vertical with no merchant layer.
					if (isMarket) {
						const { products } = await marketSearch(query, topK);
						const options = [...products]
							.sort((a, b) => a.price - b.price)
							.slice(0, topK)
							.map((p) => ({
								id: p.productId,
								name: p.name,
								price: p.price,
								merchant: "Snoonu Market",
								merchant_id: p.merchantId,
								...(p.discountPercentage
									? { discount: p.discountPercentage }
									: {}),
							}));
						return { query, found: options.length, options };
					}

					const result = await searchProducts(query, {
						category: cat,
						productSize: topK,
					});

					let openMerchants = result.merchants.filter(
						(m) =>
							(m.isOpen || m.acceptsScheduledOrders) &&
							(!merchantFilter || merchantFilter.has(m.id)),
					);

					if (deep_search && openMerchants.length > 0) {
						openMerchants = await chunkParallel(
							openMerchants,
							5,
							async (merchant) => {
								try {
									const deepProducts = await searchInMerchant(
										merchant.branchId,
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
								branch_id: m.branchId,
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
			description: `Search within a single merchant's full catalog. Use the branch_id value from a previous search_products or bulk_search result.

Returns a compact list of matching products (id, name, price, discount) from that merchant only. This is more thorough than the global search for a specific store — it queries the merchant's own search index and often returns products that search_products missed.

Does not require login. Use get_product_details(product_id) on any result for images, descriptions, and stock info.`,
			inputSchema: z.object({
				branch_id: z
					.string()
					.describe("Branch ID from search_products results"),
				query: z.string().min(1).describe("Search term within this merchant"),
			}),
			outputSchema: searchInMerchantOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		async ({ branch_id, query }) => {
			const products = await searchInMerchant(branch_id, query);

			// Persist. Prefer a merchant name we already know over the placeholder.
			const records = await Promise.all(
				products.map(async (p) => {
					const known = await getProduct(p.productId);
					return toRecord(
						p,
						known?.merchantName ?? `branch_${branch_id}`,
						branch_id,
					);
				}),
			);
			await putProducts(records);

			if (products.length === 0) {
				return ok({
					query,
					branch_id,
					products: [],
					hint: `No results for "${query}" in this merchant. Try broader terms or search_products for other merchants.`,
				});
			}

			return ok({
				query,
				branch_id,
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

The product is first looked up in the persistent store (populated by previous searches). If it is not found and a branch_id is provided, it is fetched live from the API. If neither source has the product, search for it first with search_products or search_in_merchant.`,
			inputSchema: z.object({
				product_id: z.string().min(1).describe("Product ID from search results"),
				branch_id: z
					.string()
					.optional()
					.describe(
						"Branch ID of the merchant. Required to fetch products not in the local store.",
					),
			}),
			outputSchema: productDetailsOutput,
			annotations: {
				readOnlyHint: true,
				openWorldHint: true,
			},
		},
		async ({ product_id, branch_id }) => {
			let cached = await getProduct(product_id);

			if (!cached && branch_id) {
				try {
					const live = await fetchProductById(product_id, branch_id);
					const record = toRecord(live, `branch_${branch_id}`, branch_id);
					await putProducts([record]);
					cached = record;
				} catch {
					// Fall through to the "not known" error below.
				}
			}

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

			if (cached.branchId !== undefined) detail.branch_id = cached.branchId;
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
