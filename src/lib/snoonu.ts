/**
 * Snoonu API Client
 * Refactored to be API-focused for use with Agent SDK tools
 */

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
	GlobalSearchResponse,
	GlobalSearchRequest,
	GlobalSearchMerchant,
	GlobalSearchProduct,
	SuggestInMerchantRequest,
	SuggestInMerchantResponse,
	MulticartSyncRequest,
	MulticartSyncResponse,
} from "../types/snoonu/api";
import type { CartItem } from "../types/snoonu/cart-local-storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API Constants
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

// Types
export interface SessionData {
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		httpOnly: boolean;
		secure: boolean;
		sameSite: "Strict" | "Lax" | "None";
	}>;
	localStorage?: Record<string, string>;
	sessionStorage?: Record<string, string>;
}

export interface SearchResult {
	merchants: MerchantResult[];
	query: string;
}

export interface MerchantResult {
	id: number;
	name: string;
	englishName: string;
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

export interface SnoonuClientConfig {
	headless?: boolean;
	cdpEndpoint?: string;
	sessionPath?: string;
	phoneNumber?: string;
	defaultLocation?: {
		latitude: string;
		longitude: string;
	};
}

/**
 * Snoonu API Client
 * Provides programmatic access to Snoonu shopping functionality
 */
export class SnoonuClient {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private sessionPath: string;
	private config: Required<SnoonuClientConfig>;

	constructor(config: SnoonuClientConfig = {}) {
		this.config = {
			headless: config.headless ?? false,
			cdpEndpoint: config.cdpEndpoint ?? "http://127.0.0.1:9111",
			sessionPath:
				config.sessionPath ??
				path.join(__dirname, "..", "snoonu-session.json"),
			phoneNumber: config.phoneNumber ?? process.env.SNOONU_PHONE ?? "",
			defaultLocation: config.defaultLocation ?? {
				latitude: "25.30015325558983",
				longitude: "51.49286493659019",
			},
		};
		this.sessionPath = this.config.sessionPath;
	}

	/**
	 * Initialize the browser connection and session
	 */
	async initialize(): Promise<{ loggedIn: boolean; sessionId: string }> {
		// Connect to existing browser via CDP
		this.browser = await chromium.connectOverCDP({
			endpointURL: this.config.cdpEndpoint,
		});

		// Load session if exists
		const sessionLoaded = await this.loadSession();

		if (sessionLoaded) {
			const session = JSON.parse(
				await fs.readFile(this.sessionPath, "utf-8")
			) as SessionData;

			this.context = await this.browser.newContext({
				storageState: {
					cookies: session.cookies,
					origins: session.localStorage
						? [
								{
									origin: "https://snoonu.com",
									localStorage: Object.entries(
										session.localStorage
									).map(([name, value]) => ({ name, value })),
								},
						  ]
						: [],
				},
			});
		} else {
			this.context = await this.browser.newContext();
		}

		this.page = await this.context.newPage();

		// Navigate to snoonu to ensure context is set
		await this.page.goto("https://snoonu.com", {
			waitUntil: "domcontentloaded",
		});

		const loggedIn = await this.isLoggedIn();
		const sessionId = await this.getSessionId();

		return { loggedIn, sessionId };
	}

	/**
	 * Check if session file exists and has valid auth
	 */
	private async loadSession(): Promise<boolean> {
		try {
			await fs.access(this.sessionPath);
			const session = JSON.parse(
				await fs.readFile(this.sessionPath, "utf-8")
			) as SessionData;

			const hasAuthToken = session.cookies.some(
				(cookie) => cookie.name === "authToken" && cookie.value
			);

			return hasAuthToken;
		} catch {
			return false;
		}
	}

	/**
	 * Save current session to file
	 */
	async saveSession(): Promise<void> {
		if (!this.context || !this.page) return;

		const cookies = await this.context.cookies();

		const localStorage = await this.page.evaluate(() => {
			const items: Record<string, string> = {};
			for (let i = 0; i < window.localStorage.length; i++) {
				const key = window.localStorage.key(i);
				if (key) items[key] = window.localStorage.getItem(key) || "";
			}
			return items;
		});

		const sessionData: SessionData = {
			cookies: cookies as SessionData["cookies"],
			localStorage,
		};

		await fs.writeFile(this.sessionPath, JSON.stringify(sessionData, null, 2));
	}

	/**
	 * Check if currently logged in
	 */
	async isLoggedIn(): Promise<boolean> {
		if (!this.context) return false;

		const cookies = await this.context.cookies();
		const authCookie = cookies.find((c) => c.name === "authToken");
		return !!authCookie?.value;
	}

	/**
	 * Get current session ID
	 */
	private async getSessionId(): Promise<string> {
		if (!this.page) return "";

		const deviceId = await this.page.evaluate(() => {
			return (
				localStorage.getItem("snoonu-app-device-id") ||
				`web-${crypto.randomUUID().replace(/-/g, "")}`
			);
		});

		return deviceId;
	}

	/**
	 * Get API headers for requests
	 */
	private async getApiHeaders(): Promise<Record<string, string>> {
		if (!this.page) throw new Error("Page not initialized");

		const { deviceId, token } = await this.page.evaluate(() => ({
			deviceId:
				localStorage.getItem("snoonu-app-device-id") ||
				"web-b741f08b596dfbba55b94f93d08ea032",
			token: localStorage.getItem("token") || "",
		}));

		return {
			accept: "*/*",
			"content-type": "application/json",
			appversion: "2",
			language: "en",
			latitude: this.config.defaultLocation.latitude,
			longitude: this.config.defaultLocation.longitude,
			"snoonu-app-device-id": deviceId,
			"snoonu-app-platform": "Web",
			"snoonu-app-version": "65535.65535.65535.65535",
			token: token,
		};
	}

	/**
	 * Request OTP for login
	 */
	async requestOtp(phoneNumber: string): Promise<{ success: boolean; message: string }> {
		if (!this.page) throw new Error("Page not initialized");

		try {
			// Navigate to home if not already there
			if (!this.page.url().includes("snoonu.com")) {
				await this.page.goto("https://snoonu.com", {
					waitUntil: "domcontentloaded",
				});
			}

			// Click login button
			await this.page.locator('[data-test-id="loginBtn"]').click();
			await this.page.waitForTimeout(500);

			// Dismiss location modal if present
			await this.dismissLocationModal();

			// Enter phone number
			const phoneInput = this.page.locator('[data-test-id="phoneInputField"]');
			await phoneInput.waitFor({ state: "visible", timeout: 5000 });
			await phoneInput.click();
			await phoneInput.fill(phoneNumber);

			// Click continue
			await this.page.locator('[data-test-id="btnContinueLogin"]').click();

			// Wait for OTP screen
			await this.page
				.locator('[data-test-id="pinInputField"]')
				.waitFor({ state: "visible", timeout: 30000 });

			return { success: true, message: "OTP sent successfully" };
		} catch (error) {
			return {
				success: false,
				message: `Failed to request OTP: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Verify OTP code
	 */
	async verifyOtp(otpCode: string): Promise<{ success: boolean; loggedIn: boolean; message: string }> {
		if (!this.page) throw new Error("Page not initialized");

		try {
			const otpInput = this.page.locator('[data-test-id="pinInputField"]');
			await otpInput.waitFor({ state: "visible", timeout: 5000 });
			await otpInput.fill(otpCode);

			// Wait for login to complete
			await this.page
				.locator('[data-test-id="loginBtn"]')
				.waitFor({ state: "hidden", timeout: 15000 })
				.catch(() =>
					this.page!.locator(".modal").waitFor({
						state: "hidden",
						timeout: 15000,
					})
				);

			// Wait for cookies to be set
			await this.page.waitForTimeout(2000);

			// Save session
			await this.saveSession();

			const loggedIn = await this.isLoggedIn();

			return {
				success: true,
				loggedIn,
				message: loggedIn ? "Login successful" : "OTP verified but auth token not found",
			};
		} catch (error) {
			return {
				success: false,
				loggedIn: false,
				message: `Failed to verify OTP: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Dismiss location modal if present
	 */
	private async dismissLocationModal(): Promise<void> {
		if (!this.page) return;

		try {
			const locationModal = this.page.locator(
				'button:has-text("Confirm location")'
			);
			if (
				await locationModal.isVisible({ timeout: 2000 }).catch(() => false)
			) {
				const closeBtn = this.page
					.locator('.Modal_cross__eQNMb, [class*="Modal_cross"]')
					.first();
				if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
					await closeBtn.click();
					await this.page.waitForTimeout(500);
				}
			}
		} catch {
			// Location modal not present, continue
		}
	}

	/**
	 * Search for products globally
	 */
	async searchProducts(
		query: string,
		options: {
			category?: CategoryName;
			page?: number;
			pageSize?: number;
			productSize?: number;
		} = {}
	): Promise<SearchResult> {
		if (!this.page) throw new Error("Page not initialized");

		const {
			category = "Groceries",
			page: pageNum = 0,
			pageSize = 20,
			productSize = 20,
		} = options;

		const headers = await this.getApiHeaders();

		const params: GlobalSearchRequest = {
			page: pageNum,
			page_size: pageSize,
			product_size: productSize,
			term: query,
			category_id: SNOONU_CATEGORIES[category],
		};

		const url = new URL(`${SNOONU_API_BASE}/v5/search/global`);
		url.search = new URLSearchParams(
			Object.entries(params).map(([key, value]) => [key, String(value)])
		).toString();

		// Execute request in browser context to maintain session
		const response = await this.page.evaluate(
			async ({ url, headers }) => {
				const res = await fetch(url, {
					headers,
					mode: "cors",
					credentials: "omit",
				});
				return res.json();
			},
			{ url: url.toString(), headers }
		);

		const data = response as GlobalSearchResponse;

		if (!data.is_success || !data.data) {
			throw new Error(data.error?.message || "Search failed");
		}

		return {
			query,
			merchants: data.data.merchants.map((m) => this.mapMerchant(m, query)),
		};
	}

	/**
	 * Map API merchant to result type
	 */
	private mapMerchant(merchant: GlobalSearchMerchant, query: string): MerchantResult {
		return {
			id: merchant.id,
			name: merchant.name,
			englishName: merchant.english_name,
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
				.map((p) => this.mapProduct(p, query)),
		};
	}

	/**
	 * Map API product to result type
	 */
	private mapProduct(product: GlobalSearchProduct, query: string): ProductResult {
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
			price: product.discount && originalPrice ? price : price,
			originalPrice: product.discount && originalPrice ? originalPrice : null,
			discountPercentage: product.discount_percentage,
			isInStock: product.is_instock,
			isAvailable: product.is_available,
			stockCount: product.stock_count,
			relevanceScore: this.calculateRelevance(product.name, query),
			raw: product,
		};
	}

	/**
	 * Calculate relevance score using Levenshtein similarity
	 */
	private calculateRelevance(productName: string, query: string): number {
		const name = productName.toLowerCase();
		const q = query.toLowerCase();

		// Exact match
		if (name.includes(q)) return 1.0;

		// Levenshtein similarity
		const distance = this.levenshteinDistance(name, q);
		const maxLen = Math.max(name.length, q.length);
		return maxLen === 0 ? 1 : 1 - distance / maxLen;
	}

	private levenshteinDistance(str1: string, str2: string): number {
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

	/**
	 * Search within a specific merchant
	 */
	async searchInMerchant(
		merchantId: number,
		menuId: number,
		query: string
	): Promise<ProductResult[]> {
		if (!this.page) throw new Error("Page not initialized");

		const headers = await this.getApiHeaders();

		const data: SuggestInMerchantRequest = {
			language: "en",
			menu_id: menuId,
			term: query,
		};

		const response = await this.page.evaluate(
			async ({ url, headers, data }) => {
				const res = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(data),
					mode: "cors",
					credentials: "omit",
				});
				return res.json();
			},
			{
				url: `${SNOONU_API_BASE}/search/suggest_in_merchant_with_subcategory`,
				headers,
				data,
			}
		);

		const result = response as SuggestInMerchantResponse;

		if (!result.data?.product_view_models) {
			return [];
		}

		return result.data.product_view_models
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
				relevanceScore: this.calculateRelevance(p.name, query),
				raw: p as unknown as GlobalSearchProduct,
			}));
	}

	/**
	 * Add items to cart via multicart sync
	 */
	async addToCart(
		items: Array<{
			productId: string;
			quantity: number;
			choiceItemIds?: string[];
			specialRequest?: string;
		}>
	): Promise<CartState> {
		if (!this.page) throw new Error("Page not initialized");

		const headers = await this.getApiHeaders();

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

		const response = await this.page.evaluate(
			async ({ url, headers, data }) => {
				const res = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(data),
					mode: "cors",
					credentials: "omit",
				});
				return res.json();
			},
			{
				url: `${SNOOMARKET_API_BASE}/v1/multicart/sync`,
				headers,
				data: syncRequest,
			}
		);

		const result = response as MulticartSyncResponse;

		if (!result.is_success || !result.data) {
			throw new Error(result.error?.message || "Failed to sync cart");
		}

		return {
			items: result.data.items.map((item) => ({
				productId: item.product_id,
				merchantId: item.merchant_id,
				name: item.name,
				imageUrl: item.image_url,
				price: item.price,
				quantity: item.quantity,
				totalPrice: item.total_price,
				isAvailable: item.is_available && item.is_instock,
			})),
			totalQuantity: result.data.total_quantity,
			totalPrice: result.data.full_cart_price,
			cartId: result.data.cart_id,
		};
	}

	/**
	 * Get current cart state from localStorage
	 */
	async getCart(): Promise<CartState> {
		if (!this.page) throw new Error("Page not initialized");

		const cartData = await this.page.evaluate(() => {
			const cartProducts = localStorage.getItem("marketplaceCartProducts");
			if (!cartProducts) return null;

			try {
				return JSON.parse(cartProducts);
			} catch {
				return null;
			}
		});

		if (!cartData) {
			return {
				items: [],
				totalQuantity: 0,
				totalPrice: 0,
				cartId: null,
			};
		}

		const items = Object.values(cartData as Record<string, CartItem>).map(
			(item) => ({
				productId: item.productId,
				merchantId: item.merchantId,
				name: item.name,
				imageUrl: item.imageUrl,
				price: parseFloat(item.price),
				quantity: item.count,
				totalPrice: item.totalPrice,
				isAvailable: item.isAvailable && item.isInstock,
			})
		);

		return {
			items,
			totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
			totalPrice: items.reduce((sum, item) => sum + item.totalPrice, 0),
			cartId: null,
		};
	}

	/**
	 * Navigate to checkout page
	 */
	async goToCheckout(): Promise<{
		success: boolean;
		checkoutUrl: string;
		summary: {
			itemCount: number;
			total: number;
		} | null;
	}> {
		if (!this.page) throw new Error("Page not initialized");

		try {
			await this.page.goto("https://snoonu.com/checkout", {
				waitUntil: "domcontentloaded",
			});

			const cart = await this.getCart();

			return {
				success: true,
				checkoutUrl: "https://snoonu.com/checkout",
				summary: {
					itemCount: cart.totalQuantity,
					total: cart.totalPrice,
				},
			};
		} catch (error) {
			return {
				success: false,
				checkoutUrl: "",
				summary: null,
			};
		}
	}

	/**
	 * Clear current session
	 */
	async clearSession(): Promise<void> {
		try {
			await fs.unlink(this.sessionPath);
		} catch {
			// File doesn't exist, that's fine
		}
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		await this.saveSession();
		if (this.browser) {
			await this.browser.close();
		}
	}

	/**
	 * Get raw page for advanced operations
	 */
	getPage(): Page | null {
		return this.page;
	}
}

// Export singleton instance creator
let clientInstance: SnoonuClient | null = null;

export async function getSnoonuClient(
	config?: SnoonuClientConfig
): Promise<SnoonuClient> {
	if (!clientInstance) {
		clientInstance = new SnoonuClient(config);
		await clientInstance.initialize();
	}
	return clientInstance;
}

export default SnoonuClient;
