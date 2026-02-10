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
} from "./session-manager";
import type {
	GlobalSearchRequest,
	GlobalSearchResponse,
	GlobalSearchMerchant,
	GlobalSearchProduct,
	SuggestInMerchantRequest,
	SuggestInMerchantResponse,
	MulticartSyncRequest,
	MulticartSyncResponse,
	SavedAddressesResponse,
	SavedAddress,
} from "../types/snoonu/api";

const SNOONU_API_BASE = "https://admin.snoonu.com/api";
const SNOOMARKET_API_BASE = "https://snoomarket-web.snoonu.com/api";

export const SNOONU_CATEGORIES = {
	Restaurants: 62,
	Groceries: 3,
	Market: 3895,
	Pharmacy: 129,
	Flowers: 65,
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
	menuId: number;
	url: string | null;
	distance: number;
	minEta: number;
	rating: number;
	averagePreparationTime: number;
	isFreeDeliveryEligible: boolean;
	isOpen: boolean;
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

	const {
		category = "Groceries",
		page = 0,
		pageSize = 20,
		productSize = 20,
	} = options;

	const params: GlobalSearchRequest = {
		page,
		page_size: pageSize,
		product_size: productSize,
		term: query,
		category_id: SNOONU_CATEGORIES[category],
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
		merchants: data.data.merchants.map((m) => mapMerchant(m, query)),
	};
}

// ---------- Search in Merchant ----------

export async function searchInMerchant(
	merchantId: number,
	menuId: number,
	query: string
): Promise<ProductResult[]> {
	await loadSession();
	const headers = getApiHeaders();

	const body: SuggestInMerchantRequest = {
		language: "en",
		menu_id: menuId,
		term: query,
	};

	const res = await fetch(
		`${SNOONU_API_BASE}/search/suggest_in_merchant_with_subcategory`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}
	);
	const data: SuggestInMerchantResponse = await res.json();

	if (!data.data?.product_view_models) return [];

	return data.data.product_view_models
		.filter((p) => p.is_instock && p.is_available)
		.map((p) => ({
			id: p.object_id,
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

// ---------- Cart ----------

// In-memory cart store — the single source of truth for cart contents.
// multicart/sync is a FULL REPLACEMENT endpoint: sending empty items clears
// the cart, so we must never call it to "read" — instead we track state here.
const cartStore = new Map<string, CartItemState>();
let cartId: string | null = null;

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
	if (!cartStore.has(product.productId)) {
		cartStore.set(product.productId, {
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

	// Update in-memory store from the server response.
	// The response only contains product_identity + quantity, so we merge
	// with existing details already in cartStore.
	const serverItems = new Set<string>();
	for (const item of data.data.items) {
		const pid = (item as any).product_identity?.product_id ?? (item as any).product_id;
		if (!pid) continue;
		serverItems.add(pid);
		const qty = item.quantity ?? (item as any).quantity ?? 0;
		const existing = cartStore.get(pid);
		if (existing) {
			existing.quantity = qty;
			existing.totalPrice = existing.price * qty;
		}
	}

	// Remove items the server no longer has
	for (const [pid] of cartStore) {
		if (!serverItems.has(pid)) cartStore.delete(pid);
	}

	cartId = data.data.cart_id;

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
	for (const item of items) {
		const existing = cartStore.get(item.productId);
		if (existing) {
			existing.quantity = item.quantity;
			existing.totalPrice = existing.price * item.quantity;
		} else {
			cartStore.set(item.productId, {
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
	const allItems = Array.from(cartStore.values())
		.filter((i) => i.quantity > 0)
		.map((i) => ({ productId: i.productId, quantity: i.quantity }));

	return syncCart(allItems);
}

/**
 * Get cart from in-memory store (non-destructive).
 * Never calls the API — multicart/sync with empty items clears the cart.
 */
export function getCart(): CartState {
	const items = Array.from(cartStore.values()).filter((i) => i.quantity > 0);
	const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
	const totalPrice = items.reduce((sum, i) => sum + i.totalPrice, 0);
	return { items, totalQuantity, totalPrice, cartId };
}

/** Clear the in-memory cart and sync empty state to server. */
export async function clearCartOnServer(): Promise<void> {
	cartStore.clear();
	cartId = null;
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

function mapMerchant(merchant: GlobalSearchMerchant, query: string): MerchantResult {
	return {
		id: merchant.id,
		name: merchant.name,
		englishName: merchant.english_name,
		menuId: merchant.menu_id,
		url: merchant.url_friendly_name
			? `/en/merchant/${merchant.url_friendly_name}`
			: null,
		distance: merchant.distance,
		minEta: merchant.min_eta,
		rating: merchant.rating,
		averagePreparationTime: merchant.average_preparation_time,
		isFreeDeliveryEligible:
			merchant.subscription_benefits.s_plus.is_free_delivery_eligible,
		isOpen: merchant.info_merchant.status.toLowerCase() === "open",
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
