// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct HTTP API Client for Snoonu
 * Makes fetch() calls with auth headers — no browser needed.
 */

import {
	getApiHeaders,
	loadSession,
	saveSession,
	getSession,
	isAuthenticated,
	BROWSER_HEADERS,
} from "./session-manager";
import { PerUser } from "../mcp/lib/user-context";
import { randomUUID } from "node:crypto";
import type {
	ApiResponse,
	BaseProduct,
	GlobalSearchRequest,
	GlobalSearchResponse,
	GlobalSearchMerchant,
	GlobalSearchProduct,
	MulticartSyncRequest,
	MulticartSyncResponse,
	SavedAddressesResponse,
	SavedAddress,
} from "../types/snoonu/api";

const SNOONU_API_BASE = "https://admin.snoonu.com/api";
const SNOOMARKET_API_BASE = "https://snoomarket-web.snoonu.com/api";

/**
 * Category ids accepted by /v5/search/global, verified live against
 * POST /api/v3/category_list.
 *
 * "Market" (3895) is deliberately absent. It is the only category with
 * navigation_type: 1 — the snoomarket vertical, served by
 * snoomarket-web.snoonu.com, not by global search. Passing 3895 here is
 * indistinguishable from passing garbage: it returned 0 merchants for every
 * query tested, exactly like category_id=999999.
 */
export const SNOONU_CATEGORIES = {
	Restaurants: 62,
	Groceries: 3,
	Pharmacy: 129,
	"Flowers & Gifts": 65,
	Charity: 4649,
	Tamwin: 5863,
	Services: 6582,
} as const;

export type CategoryName = keyof typeof SNOONU_CATEGORIES;

// ---------- Search ----------

export interface SearchResult {
	query: string;
	merchants: MerchantResult[];
}

export interface MerchantResult {
	id: number;
	name: string;
	englishName: string;
	branchId: string;
	url: string | null;
	distance: number;
	minEta: number;
	rating: number;
	averagePreparationTime: number;
	isFreeDeliveryEligible: boolean;
	isOpen: boolean;
	acceptsScheduledOrders: boolean;
	products: ProductResult[];
}

export interface ProductResult {
	id: string;
	productId: string;
	merchantId: number;
	name: string;
	englishName: string;
	description: string | null;
	imageUrl: string;
	price: number;
	originalPrice: number | null;
	discountPercentage: number | null;
	isInStock: boolean;
	isAvailable: boolean;
	stockCount: number;
	relevanceScore: number | null;
	raw: GlobalSearchProduct;
}

export interface CartState {
	items: CartItemState[];
	totalQuantity: number;
	totalPrice: number;
	cartId: string | null;
}

export interface CartItemState {
	productId: string;
	merchantId: number;
	name: string;
	imageUrl: string;
	price: number;
	quantity: number;
	totalPrice: number;
	isAvailable: boolean;
}

// ---------- Global Search ----------

export async function searchProducts(
	query: string,
	options: {
		category?: CategoryName;
		page?: number;
		pageSize?: number;
		productSize?: number;
	} = {}
): Promise<SearchResult> {
	await loadSession();
	const headers = getApiHeaders();

	const { category, page = 0, pageSize = 20, productSize = 20 } = options;

	// category_id is now OPT-IN. It used to default to Groceries (3) on every
	// call, which silently filtered out anything non-grocery — "running shoes"
	// returned zero merchants. snoonu.com itself sends no category_id when you
	// search from the header, and omitting it returns the same results as
	// category_id=3 for grocery terms while also matching everything else.
	const params: GlobalSearchRequest = {
		page,
		page_size: pageSize,
		product_size: productSize,
		term: query,
		...(category ? { category_id: SNOONU_CATEGORIES[category] } : {}),
	};

	const url = new URL(`${SNOONU_API_BASE}/v5/search/global`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}

	const res = await fetch(url.toString(), { headers });
	const data: GlobalSearchResponse = await res.json();

	if (!data.is_success || !data.data) {
		throw new Error(data.error?.message || "Search failed");
	}

	return {
		query,
		merchants: data.data.merchants.map((m) => mapMerchant(m, query, category)),
	};
}

// ---------- Search in Merchant ----------

interface MultiSearchInMerchantRequest {
	branch_id: string;
	device_id: string;
	terms: string[];
}

type MultiSearchInMerchantResponse = ApiResponse<
	Array<{ term: string; product_view_models: BaseProduct[] }>
>;

export async function searchInMerchant(
	branchId: string,
	query: string,
): Promise<ProductResult[]> {
	await loadSession();
	const headers = getApiHeaders();

	const body: MultiSearchInMerchantRequest = {
		branch_id: branchId,
		device_id: headers["snoonu-app-device-id"]!,
		terms: [query],
	};

	const res = await fetch(
		`${SNOONU_API_BASE}/v5/search/multi_search_in_merchant`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(body),
		},
	);
	const data: MultiSearchInMerchantResponse = await res.json();

	if (!data.is_success || !data.data) {
		throw new Error(data.error?.message || "Search in merchant failed");
	}

	const products = data.data[0]?.product_view_models ?? [];

	return products
		.filter((p) => p.is_instock && p.is_available)
		.map((p) => ({
			id: p.object_id || p.product_id,
			productId: p.product_id,
			merchantId: p.merchant_id,
			name: p.name,
			englishName: p.english_name,
			description: p.description,
			imageUrl: p.image_url,
			price: parseFloat(p.price),
			originalPrice: p.price_old ? parseFloat(p.price_old) : null,
			discountPercentage: p.discount_percentage,
			isInStock: p.is_instock,
			isAvailable: p.is_available,
			stockCount: p.stock_count,
			relevanceScore: calculateRelevance(p.name, query),
			raw: p as unknown as GlobalSearchProduct,
		}));
}

// ---------- Product Details ----------

type ProductDetailResponse = ApiResponse<BaseProduct & Record<string, unknown>>;

export async function fetchProductById(
	productId: string,
	branchId: string,
): Promise<ProductResult> {
	await loadSession();
	const headers = getApiHeaders();

	const res = await fetch(
		`${SNOONU_API_BASE}/v7/products/${encodeURIComponent(productId)}?branch_id=${encodeURIComponent(branchId)}`,
		{ headers },
	);
	const data: ProductDetailResponse = await res.json();

	if (!data.is_success || !data.data) {
		throw new Error(data.error?.message || "Failed to fetch product");
	}

	const p = data.data;
	return {
		id: p.object_id || p.product_id,
		productId: p.product_id,
		merchantId: p.merchant_id,
		name: p.name,
		englishName: p.english_name,
		description: p.description,
		imageUrl: p.image_url,
		price: parseFloat(p.price),
		originalPrice: p.price_old ? parseFloat(p.price_old) : null,
		discountPercentage: p.discount_percentage,
		isInStock: p.is_instock,
		isAvailable: p.is_available,
		stockCount: p.stock_count,
		relevanceScore: null,
		raw: p as unknown as GlobalSearchProduct,
	};
}

// ---------- OTP login over plain HTTP (no browser) ----------

/**
 * Snoonu's OTP endpoints, usable server-to-server.
 *
 * The browser path (Playwright: launch Chromium, wait for hydration, fight the
 * location modal, type into a controlled React input, wait for the PIN screen)
 * has a ~106s worst-case budget and blew through the proxy timeout in
 * production. These two calls do the same job in about a second, and remove the
 * Chromium dependency from login entirely.
 *
 * Two non-obvious details, both verified against the live API:
 *  - otp_request_v2 reads a header literally named `deviceid`. Sending only
 *    `snoonu-app-device-id` fails every time with a generic StandardError that
 *    looks identical to a malformed body.
 *  - The `token` field is the reCAPTCHA slot. For Qatar (`re_captcha: false` in
 *    /api/v1/country_codes) it is not actually verified — it only has to be a
 *    non-empty string. Other countries may genuinely enforce it.
 */
const QATAR_DIAL_CODE = "+974";
/** Upper bound on the Snoonu OTP calls; a stalled connect otherwise hangs sign-in. */
const OTP_TIMEOUT_MS = 15_000;

function otpHeaders(deviceId: string): Record<string, string> {
	return {
		...BROWSER_HEADERS,
		accept: "*/*",
		"content-type": "application/json",
		appversion: "2",
		language: "en",
		latitude: "25.285564",
		longitude: "51.531445",
		deviceid: deviceId,
		"snoonu-app-device-id": deviceId,
		"snoonu-app-platform": "Web",
		"snoonu-app-version": "65535.65535.65535.65535",
	};
}

/** Ask Snoonu to SMS a login code. Returns a human-readable outcome. */
export async function requestOtpViaApi(
	phone: string,
	deviceId: string,
	countryCode = QATAR_DIAL_CODE,
): Promise<{ success: boolean; message: string }> {
	const url = `${SNOONU_API_BASE}/v3/otp_request/otp_request_v2`;

	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: otpHeaders(deviceId),
			body: JSON.stringify({
				country_code: countryCode,
				phone: phone.replace(/\D/g, ""),
				// reCAPTCHA slot — must be non-empty; not verified for Qatar.
				token: randomUUID(),
			}),
			// Without this a stalled connection hangs the sign-in page until the
			// proxy gives up, which is indistinguishable from a crash.
			signal: AbortSignal.timeout(OTP_TIMEOUT_MS),
		});
	} catch (err) {
		// Reaching Snoonu at all is the thing that fails when the deployment
		// host has no egress to admin.snoonu.com, so say that rather than
		// letting a bare "fetch failed" reach the user.
		const reason = err instanceof Error ? err.message : String(err);
		const timedOut = err instanceof Error && err.name === "TimeoutError";
		return {
			success: false,
			message: timedOut
				? `Snoonu did not respond within ${OTP_TIMEOUT_MS / 1000}s (${url}).`
				: `Could not reach Snoonu at ${url} — ${reason}. If this server is hosted, check that it has outbound network access to admin.snoonu.com.`,
		};
	}

	// Read once as text: a blocked/rate-limited response is often an HTML or
	// plain-text page, and res.json() would discard the only useful evidence.
	const body = await res.text().catch(() => "");
	let data: { success?: boolean; message?: string } | null = null;
	try {
		data = JSON.parse(body) as { success?: boolean; message?: string };
	} catch {
		data = null;
	}

	if (data?.success) {
		return { success: true, message: data.message ?? "Code sent." };
	}
	if (data?.message) {
		return { success: false, message: data.message };
	}
	// Non-JSON body => not Snoonu's API talking, but something in front of it
	// (CDN block page, WAF, captive proxy). "Check the phone number" was the
	// old guess here and sent people chasing the wrong problem.
	const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
	return {
		success: false,
		message: `Snoonu returned HTTP ${res.status} with a non-JSON body${
			snippet ? `: ${snippet}` : "."
		}`,
	};
}

export interface OtpVerifyResult {
	success: boolean;
	message: string;
	authToken?: string;
	identity?: SnoonuIdentity;
}

/** Exchange the SMS code for an auth token. */
export async function verifyOtpViaApi(
	phone: string,
	otp: string,
	deviceId: string,
	countryCode = QATAR_DIAL_CODE,
): Promise<OtpVerifyResult> {
	const res = await fetch(`${SNOONU_API_BASE}/v3/otp_verify`, {
		method: "POST",
		headers: otpHeaders(deviceId),
		body: JSON.stringify({
			country_code: countryCode,
			phone: phone.replace(/\D/g, ""),
			otp: otp.replace(/\D/g, ""),
		}),
	});

	const data = await res.json().catch(() => null);
	if (!data?.success || !data?.token) {
		return {
			success: false,
			message: data?.message ?? `Verification failed (HTTP ${res.status}).`,
		};
	}

	const customer = data.customer ?? {};
	return {
		success: true,
		message: "Signed in.",
		authToken: data.token,
		identity: customer?.id
			? {
					id: customer.id,
					phone: String(customer.phone ?? phone),
					name: customer.name,
				}
			: undefined,
	};
}

// ---------- Account identity ----------

export interface SnoonuIdentity {
	id: number;
	phone: string;
	name?: string;
}

/**
 * Resolve who a token belongs to, and thereby validate it.
 *
 * Snoonu returns HTTP 200 for an invalid or empty token on most endpoints
 * (verified: /v6/address answers 200 with a bad token), so status codes are
 * useless for validation. `customer_data` is the exception that is actually
 * usable: with a good token it returns an object carrying `id` and `phone`;
 * with a bad or empty one it returns 200 and an EMPTY body. Presence of `id`
 * is therefore the signal.
 *
 * Takes credentials explicitly rather than reading the ambient session, because
 * it is used to check a token BEFORE any session exists for that user.
 */
export async function fetchIdentity(
	authToken: string,
	deviceId: string,
): Promise<SnoonuIdentity | null> {
	const res = await fetch(`${SNOONU_API_BASE}/v3/customer_data`, {
		method: "POST",
		headers: {
			accept: "*/*",
			"content-type": "application/json",
			appversion: "2",
			language: "en",
			latitude: "25.285564",
			longitude: "51.531445",
			"snoonu-app-device-id": deviceId,
			"snoonu-app-platform": "Web",
			"snoonu-app-version": "65535.65535.65535.65535",
			token: authToken,
		},
		body: "{}",
	});

	const text = await res.text();
	if (!text.trim()) return null; // empty body == rejected credential

	try {
		const data = JSON.parse(text);
		if (!data?.id || !data?.phone) return null;
		// Deliberately NOT returning email/pin — customer_data also echoes the
		// account PIN, which this server has no business holding onto.
		return { id: data.id, phone: String(data.phone), name: data.name };
	} catch {
		return null;
	}
}

// ---------- Snoomarket (the "Market" vertical) ----------

/**
 * Market is category 3895 with navigation_type: 1 — a separate vertical served
 * by snoomarket-web.snoonu.com. /v5/search/global returns 0 merchants for it no
 * matter the query, which is why "Market" searches silently came back empty.
 *
 * Note the endpoint is v3, not v4: v4's search_dynamic_content accepts the
 * request and returns 200, but IGNORES search_term — "milk", "iphone" and
 * "zzzqqqxyz" all return byte-identical category feeds. v3 actually searches.
 * The field is snake_case (`market_place_category_id`); camelCase yields a 400.
 */
const SNOOMARKET_ROOT_CATEGORY_ID = "6544e4cf116503eb3f28a09b";

interface MarketSettingsCategory {
	id: string;
	name: string;
	children?: Array<{ id: string; name: string }>;
}

// Public catalogue data, not user-specific — deliberately shared across all users.
let marketCategoryCache: MarketSettingsCategory | null = null;

/** Root Market category plus its subcategories. Cached — the payload is ~189KB. */
export async function getMarketCategories(): Promise<MarketSettingsCategory> {
	if (marketCategoryCache) return marketCategoryCache;
	await loadSession();
	const headers = getApiHeaders();

	try {
		const res = await fetch(
			`${SNOOMARKET_API_BASE}/v1/marketplace/web/settings`,
			{ headers },
		);
		const data = await res.json();
		const root = data?.data?.market_place_categories;
		if (root?.id) {
			marketCategoryCache = root as MarketSettingsCategory;
			return marketCategoryCache;
		}
	} catch {
		// fall through to the hardcoded root
	}
	marketCategoryCache = { id: SNOOMARKET_ROOT_CATEGORY_ID, name: "Market", children: [] };
	return marketCategoryCache;
}

/** Search the Snoomarket catalogue. Works anonymously. */
export async function searchMarket(
	query: string,
	options: { categoryId?: string; page?: number; pageSize?: number } = {},
): Promise<ProductResult[]> {
	await loadSession();
	const headers = getApiHeaders();

	const body = {
		market_place_category_id: options.categoryId ?? SNOOMARKET_ROOT_CATEGORY_ID,
		search_term: query,
		endless_product_block_size: options.pageSize ?? 20,
		page_size: 1,
		offset: options.page ?? 0,
	};

	const res = await fetch(
		`${SNOOMARKET_API_BASE}/v3/marketplace/category/dynamic_content`,
		{ method: "POST", headers, body: JSON.stringify(body) },
	);

	if (!res.ok) {
		throw new Error(
			`Market search failed (HTTP ${res.status}). Required headers are ` +
				`snoonu-app-device-id, snoonu-app-version and snoonu-app-platform.`,
		);
	}

	const data = await res.json();
	const blocks: any[] = data?.data?.blocks ?? [];
	const products: any[] = blocks
		.flatMap((b) => b?.body?.items ?? [])
		.map((i) => i?.product)
		.filter(Boolean);

	return products
		.filter((p) => p.is_instock && p.is_available)
		.map((p) => {
			const price = parseFloat(p.price);
			const originalPrice = p.price_old ? parseFloat(p.price_old) : null;
			return {
				// `id` is ALWAYS 0 on marketplace products — never key off it.
				id: p.object_id || p.product_id,
				productId: p.product_id,
				merchantId: p.merchant_id,
				name: p.name,
				englishName: p.english_name,
				description: p.description ?? null,
				imageUrl: p.image_url,
				price,
				originalPrice,
				// discount_percentage is not returned here; derive it.
				discountPercentage:
					originalPrice && originalPrice > price
						? Math.round(((originalPrice - price) / originalPrice) * 100)
						: null,
				isInStock: p.is_instock,
				isAvailable: p.is_available,
				stockCount: p.stock_count ?? 0,
				relevanceScore: calculateRelevance(p.name, query),
				raw: p as unknown as GlobalSearchProduct,
			} satisfies ProductResult;
		});
}

// ---------- Cart ----------

// In-memory cart store — the single source of truth for cart contents.
// multicart/sync is a FULL REPLACEMENT endpoint: sending empty items clears
// the cart, so we must never call it to "read" — instead we track state here.
const carts = new PerUser<Map<string, CartItemState>>(() => new Map());
const cartIds = new PerUser<string | null>(() => null);

/**
 * Replace the in-memory cart with a previously persisted set of items.
 *
 * The in-memory store is still the source of truth for a single sync cycle
 * (multicart/sync is full-replacement and the API silently drops items it
 * doesn't recognise, so reconciling from the response would wipe the cart).
 * But "in-memory" used to mean "gone on restart" — this lets the MCP tool layer
 * rehydrate it from disk/Redis so a cart survives across processes.
 */
export function hydrateCart(items: CartItemState[], id?: string | null): void {
	const store = carts.get();
	store.clear();
	for (const i of items) store.set(i.productId, { ...i });
	if (id !== undefined) cartIds.set(id);
}

/** Register product details so add-to-cart can populate the in-memory store. */
export function registerProductForCart(product: {
	productId: string;
	merchantId: number;
	name: string;
	imageUrl: string;
	price: number;
	isAvailable: boolean;
}): void {
	// Only store if not already in cart (don't overwrite quantity)
	const store = carts.get();
	if (!store.has(product.productId)) {
		store.set(product.productId, {
			...product,
			quantity: 0,
			totalPrice: 0,
		});
	}
}

/**
 * Sync the FULL in-memory cart to the server.
 * multicart/sync replaces the entire server-side cart with what we send.
 */
export async function syncCart(
	items: Array<{
		productId: string;
		quantity: number;
		choiceItemIds?: string[];
		specialRequest?: string;
	}>
): Promise<CartState> {
	await loadSession();
	const headers = getApiHeaders();

	if (!isAuthenticated()) {
		throw new Error("Must be logged in to modify cart");
	}

	const syncRequest: MulticartSyncRequest = {
		items: items.map((item) => ({
			product_identity: {
				product_id: item.productId,
				choice_item_ids: item.choiceItemIds || [],
				special_request: item.specialRequest || "",
			},
			quantity: item.quantity,
		})),
	};

	const res = await fetch(`${SNOOMARKET_API_BASE}/v1/multicart/sync`, {
		method: "POST",
		headers,
		body: JSON.stringify(syncRequest),
	});
	const data: MulticartSyncResponse = await res.json();

	if (!data.is_success || !data.data) {
		throw new Error(data.error?.message || "Failed to sync cart");
	}

	// Fire orders/open to activate cart server-side (mirrors browser behavior).
	fetch(`${SNOONU_API_BASE}/v5/orders/open`, {
		headers,
		method: "GET",
	}).catch(() => {});

	// Extract cart_id from server response. We do NOT reconcile our in-memory
	// store with the response because the API silently drops items it doesn't
	// recognise (returns 200 + empty items). Our in-memory store is the source
	// of truth; reconciling would wipe the cart.
	cartIds.set(data.data.cart_id);

	// Log discrepancies for debugging (stderr so it doesn't pollute MCP JSON).
	const sentCount = items.length;
	const serverCount = data.data.items?.length ?? 0;
	if (serverCount !== sentCount) {
		console.error(
			`[cart] multicart/sync: sent ${sentCount} items, server accepted ${serverCount}. ` +
			`cart_id=${cartIds.get()}, total_quantity=${data.data.total_quantity}, full_cart_price=${data.data.full_cart_price}`
		);
	}

	return getCart();
}

/**
 * Add items to the cart. Merges with existing in-memory cart, then syncs
 * the full cart to the server.
 */
export async function addToCart(
	items: Array<{
		productId: string;
		quantity: number;
		name?: string;
		merchantId?: number;
		imageUrl?: string;
		price?: number;
		isAvailable?: boolean;
	}>
): Promise<CartState> {
	// Merge into in-memory store
	const store = carts.get();
	for (const item of items) {
		const existing = store.get(item.productId);
		if (existing) {
			existing.quantity = item.quantity;
			existing.totalPrice = existing.price * item.quantity;
		} else {
			store.set(item.productId, {
				productId: item.productId,
				merchantId: item.merchantId ?? 0,
				name: item.name ?? item.productId,
				imageUrl: item.imageUrl ?? "",
				price: item.price ?? 0,
				quantity: item.quantity,
				totalPrice: (item.price ?? 0) * item.quantity,
				isAvailable: item.isAvailable ?? true,
			});
		}
	}

	// Build full cart for sync (all items, not just new ones)
	const allItems = Array.from(store.values())
		.filter((i) => i.quantity > 0)
		.map((i) => ({ productId: i.productId, quantity: i.quantity }));

	return syncCart(allItems);
}

/**
 * Get cart from in-memory store (non-destructive).
 * Never calls the API — multicart/sync with empty items clears the cart.
 */
export function getCart(): CartState {
	const items = Array.from(carts.get().values()).filter((i) => i.quantity > 0);
	const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
	const totalPrice = items.reduce((sum, i) => sum + i.totalPrice, 0);
	return { items, totalQuantity, totalPrice, cartId: cartIds.get() };
}

/** Clear the in-memory cart and sync empty state to server. */
export async function clearCartOnServer(): Promise<void> {
	carts.get().clear();
	cartIds.set(null);
	await loadSession();
	const headers = getApiHeaders();
	if (!isAuthenticated()) return;
	await fetch(`${SNOOMARKET_API_BASE}/v1/multicart/sync`, {
		method: "POST",
		headers,
		body: JSON.stringify({ items: [] }),
	});
}

// ---------- Address / Location ----------

export interface AddressResult {
	id: number;
	label: string;
	address: string;
	latitude: number;
	longitude: number;
	phone: string;
	notes: string | null;
	buildingNumber: string | null;
	floorFlat: string | null;
	leaveAtDoor: boolean;
	ringDoorbell: boolean;
	country: string;
}

/**
 * Get all saved delivery addresses for the logged-in user.
 */
export async function getSavedAddresses(): Promise<AddressResult[]> {
	await loadSession();
	const headers = getApiHeaders();

	if (!isAuthenticated()) {
		throw new Error("Must be logged in to get saved addresses");
	}

	const res = await fetch(`${SNOONU_API_BASE}/v6/address`, { headers });
	const data: SavedAddressesResponse = await res.json();

	if (!data.is_success || !data.data) {
		throw new Error(data.error?.message || "Failed to fetch addresses");
	}

	return data.data.map((a) => ({
		id: a.id,
		label: a.custom_address_name || locationTypeLabel(a.location_type),
		address: a.address,
		latitude: a.latitude,
		longitude: a.longitude,
		phone: a.phone,
		notes: a.notes,
		buildingNumber: a.address_details.find((d) => d.address_detail_label === 0)?.value ?? null,
		floorFlat: a.address_details.find((d) => d.address_detail_label === 1)?.value ?? null,
		leaveAtDoor: a.leave_at_the_door,
		ringDoorbell: a.ring_the_doorbell,
		country: a.tenant_info.country_name,
	}));
}

/**
 * Set the active delivery location by address ID.
 * Updates the session with the new coordinates so subsequent API calls
 * use the correct lat/lng headers.
 */
export async function setDeliveryLocation(addressId: number): Promise<AddressResult> {
	const addresses = await getSavedAddresses();
	const address = addresses.find((a) => a.id === addressId);

	if (!address) {
		throw new Error(`Address ID ${addressId} not found. Use get_saved_addresses to see available addresses.`);
	}

	// Update session with new coordinates
	const session = getSession();
	if (session) {
		session.location = {
			latitude: String(address.latitude),
			longitude: String(address.longitude),
			address: address.address,
		};
		// Update locationToken to match what the browser cookie would contain
		session.locationToken = encodeURIComponent(
			JSON.stringify({
				id: address.id,
				name: address.address,
				coordinates: { lat: address.latitude, lng: address.longitude },
			})
		);
		await saveSession(session);
	}

	return address;
}

function locationTypeLabel(type: number): string {
	switch (type) {
		case 0: return "Home";
		case 1: return "Office";
		case 2: return "Work";
		case 3: return "Other";
		default: return "Other";
	}
}

// ---------- Helpers ----------

/**
 * Map a category name to the URL slug used on snoonu.com.
 * The merchant's numeric `vertical` field is NOT reliable for this purpose —
 * e.g. vertical=1 serves under /groceries/ for non-pharmacy merchants — so we
 * only derive a URL when the search category is known.
 */
const CATEGORY_SLUGS: Record<string, string> = {
	Restaurants: "restaurants",
	Groceries: "groceries",
	Pharmacy: "pharmacy",
};

function merchantUrl(
	urlFriendlyName: string | undefined,
	category?: CategoryName,
): string | null {
	if (!urlFriendlyName) return null;
	const slug = category && CATEGORY_SLUGS[category];
	if (!slug) return null;
	return `/${slug}/${urlFriendlyName}`;
}

function mapMerchant(
	merchant: GlobalSearchMerchant,
	query: string,
	category?: CategoryName,
): MerchantResult {
	const status = merchant.info_merchant.status.toLowerCase();
	return {
		id: merchant.id,
		name: merchant.name,
		englishName: merchant.english_name,
		branchId: merchant.branch_id,
		url: merchantUrl(merchant.url_friendly_name, category),
		distance: merchant.distance,
		minEta: merchant.min_eta,
		rating: merchant.rating,
		averagePreparationTime: merchant.average_preparation_time,
		isFreeDeliveryEligible:
			merchant.subscription_benefits.s_plus.is_free_delivery_eligible,
		isOpen: status === "open" || status === "one_hour_left",
		acceptsScheduledOrders:
			status === "busy" || status === "available_for_scheduled_delivery",
		products: merchant.products
			.filter((p) => p.is_instock && p.is_available)
			.map((p) => mapProduct(p, query)),
	};
}

function mapProduct(product: GlobalSearchProduct, query: string): ProductResult {
	const price = parseFloat(product.price);
	const originalPrice = product.price_old
		? parseFloat(product.price_old)
		: null;

	return {
		id: product.object_id,
		productId: product.product_id,
		merchantId: product.merchant_id,
		name: product.name,
		englishName: product.english_name,
		description: product.description,
		imageUrl: product.image_url,
		price,
		originalPrice: product.discount && originalPrice ? originalPrice : null,
		discountPercentage: product.discount_percentage,
		isInStock: product.is_instock,
		isAvailable: product.is_available,
		stockCount: product.stock_count,
		relevanceScore: calculateRelevance(product.name, query),
		raw: product,
	};
}

function calculateRelevance(productName: string, query: string): number {
	const name = productName.toLowerCase();
	const q = query.toLowerCase();

	if (name.includes(q)) return 1.0;

	const distance = levenshteinDistance(name, q);
	const maxLen = Math.max(name.length, q.length);
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

function levenshteinDistance(str1: string, str2: string): number {
	const len1 = str1.length;
	const len2 = str2.length;
	const matrix: number[][] = Array(len2 + 1)
		.fill(null)
		.map(() => Array(len1 + 1).fill(0));

	for (let i = 0; i <= len2; i++) matrix[i]![0] = i;
	for (let j = 0; j <= len1; j++) matrix[0]![j] = j;

	for (let i = 1; i <= len2; i++) {
		for (let j = 1; j <= len1; j++) {
			const cost = str2[i - 1] === str1[j - 1] ? 0 : 1;
			matrix[i]![j] = Math.min(
				matrix[i - 1]![j]! + 1,
				matrix[i]![j - 1]! + 1,
				matrix[i - 1]![j - 1]! + cost
			);
		}
	}

	return matrix[len2]![len1]!;
}
