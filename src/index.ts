import * as fs from "fs/promises";
import * as path from "path";
import type {
	Browser,
	BrowserContext,
	Cookie,
	Locator,
	Page,
} from "playwright";
import { chromium } from "playwright";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { array, number, object, string } from "valibot";
import { queryOpenRouter } from "./openrouter.ts";
import type {
	GlobalSearchResponse as GlobalSearch,
	GlobalSearchRequest as GlobalSearchApiRequestParams,
	GlobalSearchMerchant as GlobalSearchApiMerchant,
	GlobalSearchProduct as Product,
	SuggestInMerchantRequest,
	SuggestInMerchantResponse,
	SuggestInMerchantProduct,
	MulticartSyncRequest as SyncCartRequest,
} from "./types/snoonu/api";
import type { CartItem } from "./types/snoonu/cart-local-storage.ts";
import type {
	MerchantSuggestApiResponse,
	MerchantSuggestionData,
} from "./types/snoonu/suggest-in-merchants-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Merchant = {
	name: string;
	url: string | null;
	distance: number | null;
	min_eta: number | null;
	items: Item[];
	rating: number | null;
	average_preparation_time: number | null;
	is_free_delivery_eligible: boolean;
};

type Item = {
	id: string | null;
	name: string;
	description: string | null;
	image?: string | null;
	price: number;
	discounted_price: number | null;
	url: string | null;
	relevance_score?: number;
	product?: Product;
};

interface SessionData {
	cookies: Cookie[];
	localStorage?: Record<string, string>;
	sessionStorage?: Record<string, string>;
}

let captured_data: Partial<GlobalSearch> = {};

const SNOONU_CATEGORIES = {
	Restaurants: 62,
	Groceries: 3,
	Market: 3895,
	Pharmacy: 129,
	Flowers: 65,
} as const;

function sortItems(items: Item[]) {
	// Find price range for scaling
	const prices = items.map((i) => i.price);
	const maxPrice = Math.max(...prices);
	const minPrice = Math.min(...prices);
	const priceRange = maxPrice - minPrice || 1;

	return items.sort((a, b) => {
		// Normalize price to 0-1 (lower is better)
		const aNormPrice = (a.price - minPrice) / priceRange;
		const bNormPrice = (b.price - minPrice) / priceRange;

		// Relevancy already 0-1 (higher is better)
		// So invert it to make it minimizable
		const aNormRelevancy = 1 - (a.relevance_score ?? 0);
		const bNormRelevancy = 1 - (b.relevance_score ?? 0);

		// Combined score (lower is better)
		const aScore = aNormPrice * 0.5 + aNormRelevancy * 0.5;
		const bScore = bNormPrice * 0.5 + bNormRelevancy * 0.5;

		return aScore - bScore;
	});
}

type MerchantScore = {
	merchant: Merchant;
	bestItems: Item[];
	subtotal: number;
	deliveryFee: number;
	total: number;
	avgRelevancy: number;
	eta: number;
	rating: number;
};

function sortMerchants(
	merchants: Merchant[],
	quantityNeeded: number = 1
): MerchantScore[] {
	const scored = merchants
		.map((merchant) => {
			// Get items sorted by relevancy + price

			const sortedItems = sortItems(merchant.items);
			const bestItems = sortedItems.slice(0, quantityNeeded);

			if (bestItems.length === 0) return null;

			const subtotal = bestItems.reduce(
				(sum, item) => sum + item.price,
				0
			);
			const avgRelevancy =
				bestItems.reduce((sum, item) => sum + (item.relevance_score ?? 0), 0) /
				bestItems.length;
			const deliveryFee = merchant.is_free_delivery_eligible ? 0 : 10;

			return {
				merchant,
				bestItems,
				subtotal,
				deliveryFee,
				total: subtotal + deliveryFee,
				avgRelevancy,
				eta: merchant.min_eta,
				rating: merchant.rating,
			};
		})
		.filter((m): m is MerchantScore => m !== null);

	// Sort by combined score
	return scored.sort((a, b) => {
		// Normalize factors to 0-1
		const prices = scored.map((s) => s.total);
		const maxPrice = Math.max(...prices);
		const minPrice = Math.min(...prices);
		const priceRange = maxPrice - minPrice || 1;

		const aNormPrice = (a.total - minPrice) / priceRange;
		const bNormPrice = (b.total - minPrice) / priceRange;

		const aNormRelevancy = 1 - a.avgRelevancy;
		const bNormRelevancy = 1 - b.avgRelevancy;

		const aNormEta = a.eta / 60; // normalize to 0-1 assuming max 60 min
		const bNormEta = b.eta / 60;

		const aNormRating = 1 - a.rating / 5; // invert: higher rating = lower score
		const bNormRating = 1 - b.rating / 5;

		// Weighted score (adjust weights as needed)
		const aScore =
			aNormPrice * 0.5 + // price is most important
			aNormRelevancy * 0.3 + // relevancy matters
			aNormEta * 0.1 + // delivery time
			aNormRating * 0.1; // merchant quality

		const bScore =
			bNormPrice * 0.5 +
			bNormRelevancy * 0.3 +
			bNormEta * 0.1 +
			bNormRating * 0.1;

		return aScore - bScore;
	});
}

function chunkArray<T>(arr: T[], size: number): T[][] {
	return arr.reduce((resultArray, item, index) => {
		const chunkIndex = Math.floor(index / size);
		if (!resultArray[chunkIndex]) {
			resultArray[chunkIndex] = []; // start a new chunk
		}
		resultArray[chunkIndex].push(item);
		return resultArray;
	}, [] as T[][]);
}

function levenshteinDistance(str1: string, str2: string): number {
	const len1 = str1.length;
	const len2 = str2.length;

	// Create matrix
	const matrix: number[][] = Array(len2 + 1)
		.fill(null)
		.map(() => Array(len1 + 1).fill(0));

	// Initialize first row and column
	for (let i = 0; i <= len2; i++) matrix[i]![0] = i;
	for (let j = 0; j <= len1; j++) matrix[0]![j] = j;

	// Fill matrix
	for (let i = 1; i <= len2; i++) {
		for (let j = 1; j <= len1; j++) {
			const cost = str2[i - 1] === str1[j - 1] ? 0 : 1;
			matrix[i]![j] = Math.min(
				matrix[i - 1]![j]! + 1, // deletion
				matrix[i]![j - 1]! + 1, // insertion
				matrix[i - 1]![j - 1]! + cost // substitution
			);
		}
	}

	return matrix[len2]![len1]!;
}

function levenshteinSimilarity(str1: string, str2: string): number {
	const distance = levenshteinDistance(str1, str2);
	const maxLen = Math.max(str1.length, str2.length);
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

class SnoonuAutomation {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private isHandlingLogin: boolean = false;
	private sessionFile: string = path.join(__dirname, "snoonu-session.json");
	private loginCheckInterval: NodeJS.Timeout | null = null;
	private lastSavedAuthToken: string | null = null;
	private config: {
		headless: boolean;
		slowMo: number;
		phoneNumber: string;
		autoHandleLogin: boolean;
		checkLoginInterval: number;
	};

	constructor() {
		this.config = {
			headless: false,
			slowMo: 300,
			phoneNumber: process.env.SNOONU_PHONE || "",
			autoHandleLogin: true,
			checkLoginInterval: 2000, // Check every 2 seconds
		};
	}

	async initialize() {
		console.log("🚀 Initializing Snoonu automation...");

		// Launch browser
		this.browser = await chromium.connectOverCDP({
			endpointURL: "http://127.0.0.1:9111",
		});

		// Create context with saved session if exists
		await this.createContextWithSession();

		// Create page
		this.page = await this.context!.newPage();

		// Set up login monitoring
		if (this.config.autoHandleLogin) {
			this.setupLoginMonitoring();
		}

		// Don't save on every page load - only save when auth state changes

		console.log("✅ Automation initialized");
	}

	private async createContextWithSession() {
		const sessionExists = await this.loadSession();

		if (sessionExists) {
			console.log("📂 Loading saved session...");
			const session = JSON.parse(
				await fs.readFile(this.sessionFile, "utf-8")
			) as SessionData;

			// Create context with stored cookies and storage state
			this.context = await this.browser!.newContext({
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

			console.log(
				`✅ Session restored with ${session.cookies.length} cookies`
			);
			const authCookie = session.cookies.find(
				(c) => c.name === "authToken"
			);
			if (authCookie) {
				console.log(
					"🔑 Auth token restored:",
					authCookie.value.substring(0, 10) + "..."
				);
				this.lastSavedAuthToken = authCookie.value;
			}
		} else {
			console.log("🆕 Creating new session...");
			this.context = await this.browser!.newContext();
		}
	}

	private async loadSession(): Promise<boolean> {
		try {
			await fs.access(this.sessionFile);
			const session = JSON.parse(
				await fs.readFile(this.sessionFile, "utf-8")
			) as SessionData;

			// Check if we have valid auth cookies
			const hasAuthToken = session.cookies.some(
				(cookie) => cookie.name === "authToken" && cookie.value
			);

			if (!hasAuthToken) {
				console.log("⚠️ Session file exists but no auth token found");
				return false;
			}

			return true;
		} catch (error) {
			console.log("📝 No valid session file found");
			return false;
		}
	}

	private async saveSession(force: boolean = false) {
		if (!this.context || !this.page) return;

		try {
			// Get all cookies from the browser context (includes HttpOnly cookies)
			const cookies = await this.context.cookies();

			// Check if we have auth token
			const authCookie = cookies.find(
				(cookie) => cookie.name === "authToken"
			);

			// Only save if auth token changed or forced
			if (!force && authCookie?.value === this.lastSavedAuthToken) {
				return; // No changes, skip saving
			}

			if (authCookie) {
				this.lastSavedAuthToken = authCookie.value;
			}

			// Get localStorage and sessionStorage
			const localStorage = await this.page.evaluate(() => {
				const items: Record<string, string> = {};
				for (let i = 0; i < window.localStorage.length; i++) {
					const key = window.localStorage.key(i);
					if (key)
						items[key] = window.localStorage.getItem(key) || "";
				}
				return items;
			});

			const sessionStorage = await this.page.evaluate(() => {
				const items: Record<string, string> = {};
				for (let i = 0; i < window.sessionStorage.length; i++) {
					const key = window.sessionStorage.key(i);
					if (key)
						items[key] = window.sessionStorage.getItem(key) || "";
				}
				return items;
			});

			const sessionData: SessionData = {
				cookies,
				localStorage,
				sessionStorage,
			};

			await fs.writeFile(
				this.sessionFile,
				JSON.stringify(sessionData, null, 2)
			);
			console.log(
				`💾 Session saved (${
					cookies.length
				} cookies, authToken: ${!!authCookie})`
			);
		} catch (error) {
			console.error("Error saving session:", error);
		}
	}

	private async checkForLoginPrompt() {
		// console.log("👀 Checking if we need to log in...");
		// is modalContent and a form exists?
		const modalLocator = this.page?.locator(".modal");
		const formLocator = modalLocator?.locator("form");
		// find the word "log in" or "log" in the modal
		if (!modalLocator || !formLocator) return false;
		const modalText = await modalLocator.innerText();
		if (
			modalText.toLowerCase().includes("log in") ||
			modalText.toLowerCase().includes("log")
		) {
			console.log("🔐 Login prompt detected!");
			await this.handleLoginFlow();
		}
	}

	private setupLoginMonitoring() {
		console.log("👀 Setting up login prompt monitoring...");

		// Monitor for login modal appearance
		this.loginCheckInterval = setInterval(async () => {
			if (this.isHandlingLogin || !this.page) return;

			try {
				// Check if login modal is visible
				if (await this.checkForLoginPrompt()) {
					console.log("🔐 Login prompt detected!");
					await this.handleLoginFlow();
				}
			} catch (error) {
				// console.error('Error checking for login prompt:', error);
			}
		}, this.config.checkLoginInterval);
	}

	private async handleLoginFlow() {
		if (this.isHandlingLogin || !this.page) return;

		this.isHandlingLogin = true;
		console.log("🔄 Handling login flow...");

		try {
			// Step 1: Enter phone number
			console.log("📱 Entering phone number...");
			const phoneInput = this.page.locator(
				'input[placeholder="Mobile Number"]'
			);
			await phoneInput.waitFor({ state: "visible", timeout: 5000 });

			// Get phone number if not configured
			let phoneNumber = this.config.phoneNumber;
			if (!phoneNumber) {
				phoneNumber = await this.promptUser(
					"Enter phone number (without country code): "
				);
			}

			await phoneInput.click();
			await phoneInput.fill(phoneNumber);

			// Click continue
			console.log("➡️ Clicking continue...");
			await this.page.click('button:has-text("Continue")');

			// Step 2: Handle OTP
			console.log("⏳ Waiting for OTP screen...");

			// Wait for OTP inputs to appear
			const otpLocator = this.page.locator('input[name="pin"]');

			await otpLocator.waitFor({ state: "visible", timeout: 30000 });

			// Get OTP from user
			const otp = await this.promptUser("Enter OTP code: ");

			// Fill OTP inputs
			console.log("🔢 Entering OTP...");

			await otpLocator.fill(otp);

			// Wait for login to complete
			console.log("⏳ Waiting for login to complete...");

			// Wait for modal to disappear
			await this.page.waitForSelector('text="Log in to see discounts"', {
				state: "hidden",
				timeout: 15000,
			});

			console.log("✅ Login successful!");

			// Wait a moment for cookies to be set
			await this.page.waitForTimeout(2000);

			// Force save session after successful login
			await this.saveSession();

			// Verify auth cookie was saved
			const cookies = await this.context!.cookies();
			const authCookie = cookies.find((c) => c.name === "authToken");
			if (authCookie) {
				console.log(
					"🔑 Auth token captured:",
					authCookie.value.substring(0, 10) + "..."
				);
			} else {
				console.warn("⚠️ Warning: Auth token not found after login");
			}

			// Save session after successful login
			await this.saveSession();
		} catch (error) {
			console.error("❌ Login flow error:", error);
			await this.page.screenshot({ path: "login-error.png" });
		} finally {
			this.isHandlingLogin = false;
		}
	}

	promptUser(question: string): Promise<string> {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		return new Promise((resolve) => {
			rl.question(question, (answer) => {
				rl.close();
				resolve(answer);
			});
		});
	}

	async navigateTo(url: string) {
		if (!this.page) throw new Error("Page not initialized");

		console.log(`🌐 Navigating to ${url}`);
		await this.page.goto(url, { waitUntil: "domcontentloaded" });
		await this.page.hover("body"); // Hover anywhere on page
	}

	async performAction<T>(action: () => Promise<T>) {
		// This method wraps any action and ensures login is handled if needed
		if (!this.page) throw new Error("Page not initialized");

		try {
			return await action();
		} catch (error) {
			console.error("Action failed:", error);
			// Check if login is needed
			const needsLogin = await this.page
				.locator('text="Log in to see discounts"')
				.isVisible()
				.catch(() => false);
			if (needsLogin) {
				console.log("Login required for this action");
				await this.handleLoginFlow();
				// Retry the action
				console.log("Retrying action after login...");
				return await action();
			} else {
				throw error;
			}
		}
	}

	async REPL() {
		while (true) {
			const input = await this.promptUser("Enter command: ");
			if (input.trim() === "exit") {
				break;
			}
			await this.performAction(async () => {
				if (!this.page) return;
				const locator = this.page.locator(input);
				if (locator) {
					console.log(await locator.innerHTML());
				}
			});
		}
	}

	async globalSearchScrapeProducts() {
		if (!this.page) return;
		console.log("🔍 Scraping global search results");
		const searchResults = this.page.locator(
			"div[class*='SearchResults_group']"
		);

		await searchResults.waitFor({ state: "visible", timeout: 5000 });

		while (!captured_data.data) {
			console.log("⌚ Waiting for data to be captured...");
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		if (!captured_data.data) {
			console.log("📛 No captured data found");
			return;
		}

		return captured_data.data.merchants;
	}

	async exploreMerchantsInTabs(queries: string[], merchants: Merchant[]) {
		if (!this.page || !this.context) return;

		if (!merchants || merchants.length === 0) {
			console.log("❌ No merchants to explore");
			return;
		}

		console.log(`🔎 Found ${merchants.length} merchants to explore`);
		const result: {
			[query: string]: { [merchant: string]: { products: Item[] } };
		} = {};

		async function exploreMerchant(
			context: BrowserContext,
			merchant: Merchant
		) {
			const page = await context.newPage();
			const merchant_products = await scrapeMerchant({
				queries,
				page,
				merchant,
			});

			await page.close();
			return merchant_products;
		}

		const batches = merchants.reduce((resultArray, item, index) => {
			const chunkIndex = Math.floor(index / 5);

			if (!resultArray[chunkIndex]) {
				resultArray[chunkIndex] = []; // start a new chunk
			}

			resultArray[chunkIndex].push(item);

			return resultArray;
		}, [] as Merchant[][]);

		const results = queries.reduce((result, query) => {
			result[query] = {};
			return result;
		}, {} as Record<string, Record<string, Item[]>>);

		for (const batch of batches) {
			const batch_results = await Promise.all(
				batch.map((merchant) =>
					exploreMerchant(this.context!, merchant).then((items) => ({
						merchant: merchant.name,
						items,
					}))
				)
			);

			for (const { items: queryItems, merchant } of batch_results) {
				for (const [query, items] of Object.entries(queryItems)) {
					for (const query in Object.entries(items))
						if (!results[query]![merchant]) {
							results[query]![merchant] = items;
							continue;
						}
					results[query]![merchant]!.push(...items);
				}
			}
		}

		console.log(
			`\n📊 Exploration complete. Explored ${
				Object.keys(result).length
			} queries across merchants`
		);
		return results;

		async function scrapeMerchant({
			queries,
			page,
			merchant,
		}: {
			queries: string[];
			page: Page;
			merchant: Merchant;
		}) {
			console.log(`\n📍 Exploring merchant: ${merchant.name}`);
			const merchantUrl = `https://snoonu.com${merchant.url}`;
			if (!page.url().includes(merchantUrl)) {
				console.log(`   🌐 Opening: ${merchantUrl}`);
				await page.goto(merchantUrl, {
					waitUntil: "domcontentloaded",
				});
			}

			const results = {} as {
				[query: string]: Item[];
			};

			for (const query in queries) {
				const queryResult = await queryMerchant(page, query);
				results[query] = queryResult;
			}

			return results;

			async function queryMerchant(page: Page, query: string) {
				const searchBox = page.locator(
					'[class*="SearchInMerchant_input"]'
				);
				await searchBox.waitFor({ state: "visible", timeout: 5000 });
				await searchBox.fill(query, { timeout: 5000 });
				const [response] = await Promise.all([
					page.waitForResponse(
						(resp) =>
							resp
								.url()
								.includes("/api/search/suggest_in_merchant"),
						{ timeout: 10000 }
					),
					searchBox.press("Enter"),
				]);

				if (response.ok()) {
					const json =
						(await response.json()) as MerchantSuggestApiResponse;
					if (json.data?.length > 0) {
						const items = json.data.map(
							(item) =>
								({
									id: item.product_id,
									name: item.name,
									description: item.description,
									image: item.image_url,
									price:
										item.discount && item.price_old
											? Number.parseFloat(item.price_old)
											: Number.parseFloat(item.price),
									discounted_price:
										item.discount && item.price_old
											? Number.parseFloat(item.price_old)
											: null,
									url: null,
								} satisfies Item)
						);
						return items;
					}
				}

				const suggestedProducts = page.locator(
					'[class*="SuggestedProducts_group"]'
				);
				await suggestedProducts.waitFor({
					state: "visible",
					timeout: 5000,
				});

				let merchant_suggestion_data:
					| MerchantSuggestionData[]
					| undefined;

				if (merchant_suggestion_data) {
					const items: Item[] = [];
					items.push(
						...merchant_suggestion_data.map(
							(item) =>
								({
									id: item.product_id,
									name: item.name,
									image: item.image_url,
									price:
										item.discount && item.price_old
											? Number.parseFloat(item.price_old)
											: Number.parseFloat(item.price),
									discounted_price:
										item.discount && item.price_old
											? Number.parseFloat(item.price_old)
											: null,
									description: item.description,
									url: null,
								} satisfies Item)
						)
					);
					return items;
				}

				const productCards = await suggestedProducts
					.locator('[data-analytic-label*="productCard"]')
					.all();

				async function scrapeProductCard(
					productCard: Locator
				): Promise<Item | undefined> {
					const id = await productCard.getAttribute("id").catch(null);
					const url = await productCard.getAttribute("href");
					const name = await productCard
						.locator('[class*="ProductCardHorizontal_name"]')
						.textContent();
					if (!name) return;
					const description = await productCard
						.locator('[class*="ProductCardHorizontal_description"]')
						.textContent();
					const price_wrapper = productCard.locator(
						'[class*="priceWrapper"]'
					);
					const discount_wrapper = productCard.locator(
						'[class*="pricePromo"]'
					);
					if (
						await discount_wrapper.isVisible({
							timeout: 3000,
						})
					) {
						const price = await discount_wrapper
							.locator('[class*="oldPrice"]')
							.textContent();
						if (!price) return;
						const discountedPrice = await discount_wrapper
							.locator('[class*="newPrice"]')
							.textContent();
						return {
							id,
							name,
							description,
							price: Number.parseFloat(price.split("QR").at(0)!),
							discounted_price: Number.parseFloat(
								discountedPrice!.split("QR").at(0)!
							),
							url,
						};
					}
					const price = await price_wrapper
						.locator("h5")
						.textContent();
					if (!price) return;

					return {
						id,
						name,
						description,
						discounted_price: null,
						price: Number.parseFloat(price.split("QR").at(0)!),
						url,
					};
				}
				const products = await Promise.all(
					productCards.map((productCard) =>
						scrapeProductCard(productCard)
					)
				).then((results) => results.filter((a) => !!a));

				return products;
			}
		}
	}

	async scrapeSearchProducts(returnItems = false) {
		if (!this.page) return;

		const results: Merchant[] = [];

		const searchResults = this.page.locator(
			"div[class*='SearchResults_group']"
		);

		await searchResults.waitFor({ state: "visible", timeout: 5000 });

		if (!searchResults) {
			console.log("No search results found");
			return results;
		}

		await this.page.waitForTimeout(3000);

		const merchantsLocator = searchResults.locator(">div");

		const merchants = await merchantsLocator.all();

		if (merchants.length === 0) {
			console.log("No merchants found");
			return results;
		}

		this.context?.setDefaultTimeout(10000);
		this.context?.setDefaultNavigationTimeout(20000);

		console.log(`🔍 Found ${merchants.length} merchants`);

		async function scrapeMerchantItems(
			item: Locator
		): Promise<Item | undefined> {
			const id = await item.getAttribute("id");
			if (!id) return;
			const info = item.locator(
				'div[class*="ProductCartVerticalDescription_info"]'
			);
			const price = await info
				.locator('[class*="ProductCartVerticalDescription_price"]')
				.textContent({
					timeout: 1000,
				})
				.catch(() => null);
			if (!price) return;
			const name = await info
				.locator('[class*="ProductCartVerticalDescription_name"]')
				.textContent({
					timeout: 1000,
				})
				.catch(() => null);
			if (!name) return;
			const url = await item
				.locator("a")
				.getAttribute("href", {
					timeout: 1000,
				})
				.catch(() => null);

			return {
				id,
				name,
				description: null,
				discounted_price: null,
				// image,
				price: parseFloat(price.split("QR").at(0)!),
				url,
			};
		}

		async function scrapeMerchant(merchant: Locator) {
			const info = merchant.locator('div[class*="SearchMerchant_info"]');
			if (!info) return;
			// name SearchMerchant_name_***
			const name = await info
				.locator('[class*="SearchMerchant_name"]')
				.textContent();
			console.log(`{🛍️ Processing ${name}`);
			if (!name) return;
			const url = await merchant.locator(">a").getAttribute("href");
			if (!url) return;

			// SearchMerchant_carousel***
			const carousel = merchant.locator(
				'div[class*="SearchMerchant_carousel"]'
			);
			const items = await carousel.locator(">div").all();
			console.log(`🔍 Found ${items.length} items for ${name}`);
			const items_results = await Promise.all(
				items.map((item) =>
					returnItems ? scrapeMerchantItems(item) : null
				)
			).then((results) => results.filter((i) => !!i));
			return {
				name,
				url,
				items: items_results,
			};
		}
		const merchant_results = await Promise.all(
			merchants.map((merchant) => scrapeMerchant(merchant))
		).then((results) => results.filter((m) => !!m));
		return merchant_results;
	}

	async searchProducts(
		queries: {
			term: string;
			category?: keyof typeof SNOONU_CATEGORIES;
			amount?: number | string;
		}[],
		where: "Everywhere" | "Market" = "Everywhere",
		deepSearch = false
	) {
		return await this.performAction(async () => {
			const results: {
				query: (typeof queries)[number];
				merchants: Merchant[];
			}[] = [];
			const batches = chunkArray(queries, 5);
			for (const batch of batches) {
				const batch_results = await Promise.all(
					batch.map((query) =>
						searchForItem(this.context!, query, deepSearch).then(
							(merchants) => ({
								query,
								merchants,
							})
						)
					)
				).then((results) => results.flat());
				results.push(...batch_results);
			}

			return results;

			async function searchForItem(
				context: BrowserContext,
				{
					term,
					category = "Groceries",
					amount,
				}: (typeof queries)[number],
				deepSearch = true
			) {
				console.log(`🔍 Searching for: ${term}`);
				const page = await context.newPage();

				await page.goto("https://snoonu.com");

				// const whereDropdown = page.locator(
				// 	"div[class*='SearchSelector_wrapper']"
				// );

				// await whereDropdown.waitFor({
				// 	state: "visible",
				// 	timeout: 5000,
				// });

				// await whereDropdown.click();

				// const option = whereDropdown
				// 	.getByRole("listitem")
				// 	.filter({ hasText: where })
				// 	.first();
				// await option.click();

				// if (category) {
				// 	await page.route(
				// 		"**/search/global*",
				// 		async (route, request) => {
				// 			const url = new URL(request.url());

				// 			// Modify query parameters
				// 			url.searchParams.set(
				// 				"category_id",
				// 				SNOONU_CATEGORIES[category].toString()
				// 			);

				// 			// Continue with modified URL
				// 			await route.continue({ url: url.toString() });
				// 		}
				// 	);
				// }

				// const searchBox = page.locator('input[placeholder*="Search"]');
				// await searchBox.click();
				// await searchBox.fill(term);
				// const [response] = await Promise.all([
				// 	page.waitForResponse(
				// 		(resp) =>
				// 			new URL(resp.url()).pathname.endsWith(
				// 				"search/global"
				// 			),
				// 		{ timeout: 10000 }
				// 	),
				// 	await searchBox.press("Enter"),
				// ]);

				// if (!response.ok()) {
				// 	return [];
				// }

				// const json = (await response.json()) as GlobalSearchApiResponse;

				const merchants = await broadSearch();

				async function broadSearch() {
					const responsePromise = page.waitForResponse((response) =>
						new URL(response.url()).pathname.endsWith(
							"search/global"
						)
					);
					// Make the request in browser context
					const resultPromise = page.evaluate(
						async ({ term, category }) => {
							const deviceId =
								localStorage.getItem("snoonu-app-device-id") ||
								"web-b741f08b596dfbba55b94f93d08ea032";
							const token = localStorage.getItem("token") || "";

							const headers = {
								accept: "*/*",
								"content-type": "application/json",
								appversion: "2",
								language: "en",
								latitude: "25.30015325558983",
								longitude: "51.49286493659019",
								"snoonu-app-device-id": deviceId,
								"snoonu-app-platform": "Web",
								"snoonu-app-version": "65535.65535.65535.65535",
								token: token,
							};

							const payload: GlobalSearchApiRequestParams = {
								page: 0,
								page_size: 20,
								product_size: 20,
								term: term,
								category_id: category,
							};

							const url = new URL(
								"https://admin.snoonu.com/api/v5/search/global"
							);
							url.search = new URLSearchParams(
								Object.entries(payload).map(([key, value]) => [
									key,
									value.toString(),
								])
							).toString();

							const response = await fetch(url.toString(), {
								headers,
								mode: "cors",
								credentials: "omit",
							});

							if (!response.ok) {
								console.error(
									`${response.status}: 📛 Global Search Failed for ${term}`
								);
								return [];
							}

							const json =
								(await response.json()) as GlobalSearch;

							if (!json.data || !json.is_success) {
								throw json.error;
							}
							return json.data?.merchants ?? [];
						},
						{ term, category: SNOONU_CATEGORIES[category] }
					);
					const [_, result] = await Promise.all([
						responsePromise,
						resultPromise,
					]);
					return result;
				}

				async function mapMerchant(
					merchant: GlobalSearchApiMerchant
				): Promise<Merchant | null> {
					if (
						merchant.info_merchant.status.toLowerCase() !== "open"
					) {
						return null;
					}
					return {
						name: merchant.name,
						url: null,
						// url: await page
						// 	.locator(
						// 		`a[href*='${merchant.url_friendly_name}']`,
						// 		{}
						// 	)
						// 	.first()
						// 	.getAttribute("href")
						// 	.catch(() => null),
						distance: merchant.distance,
						average_preparation_time:
							merchant.average_preparation_time,
						is_free_delivery_eligible:
							merchant.subscription_benefits.s_plus
								.is_free_delivery_eligible,
						min_eta: merchant.min_eta,
						rating: merchant.rating,
						items: (deepSearch
							? await merchantDeepSearch(merchant)
							: await Promise.resolve(merchant.products)
						)
							.filter((p) => p.is_instock && p.is_available)
							.map((item) => ({
								id: item.product_id,
								name: item.name,
								description: item.description,
								image: item.image_url,
								price:
									item.discount && item.price_old
										? Number.parseFloat(item.price_old)
										: Number.parseFloat(item.price),
								discounted_price:
									item.discount && item.price_old
										? Number.parseFloat(item.price_old)
										: null,
								url: null,
								relevance_score: levenshteinSimilarity(
									item.name,
									term.toLowerCase()
								),
								product: item,
							})),
					};
				}

				async function merchantDeepSearch(
					merchant: GlobalSearchApiMerchant
				) {
					const responsePromise = page.waitForResponse((response) =>
						new URL(response.url()).pathname.endsWith(
							"/api/search/suggest_in_merchant_with_subcategory"
						)
					);
					const data: SuggestInMerchantRequest = {
						language: "en",
						menu_id: merchant.menu_id,
						term,
					};
					// Make the request in browser context
					const resultPromise = page.evaluate(
						async ({ data }) => {
							const deviceId =
								localStorage.getItem("snoonu-app-device-id") ||
								"web-b741f08b596dfbba55b94f93d08ea032";
							const token = localStorage.getItem("token") || "";

							const headers = {
								accept: "*/*",
								"content-type": "application/json",
								appversion: "2",
								language: "en",
								latitude: "25.30015325558983",
								longitude: "51.49286493659019",
								"snoonu-app-device-id": deviceId,
								"snoonu-app-platform": "Web",
								"snoonu-app-version": "65535.65535.65535.65535",
								token: token,
							};

							const response = await fetch(
								"https://admin.snoonu.com/api/search/suggest_in_merchant_with_subcategory",
								{
									method: "POST",
									headers,
									body: JSON.stringify(data),
									mode: "cors",
									credentials: "omit",
								}
							);

							if (!response.ok) {
								console.error(
									`${response.status}: 📛 SuggestInMerchant Failed for ${merchant.name}`
								);
								return [];
							}

							const json =
								(await response.json()) as SuggestInMerchantResponse;
							return json.data?.product_view_models ?? [];
						},
						{ data }
					);
					const [_, result] = await Promise.all([
						responsePromise,
						resultPromise,
					]);
					console.log(
						`🔍 Deep search for ${merchant.name} complete, found ${result.length} items`
					);
					return result;
				}

				const merchant_results = chunkArray(merchants, 5);

				const result: Merchant[] = [];
				for (const merchant_chunk of merchant_results) {
					const chunk_results = await Promise.all(
						merchant_chunk.map(mapMerchant)
					).then((results) => results.flat().filter((i) => !!i));
					result.push(...chunk_results);
				}
				await page.close();
				return result;
			}
		});
	}

	async addToCart(productSelector: string) {
		await this.performAction(async () => {
			if (!this.page) return;

			console.log("🛒 Adding to cart...");
			await this.page.click(productSelector);
			// Add more specific cart logic here
		});
	}

	async isLoggedIn(): Promise<boolean> {
		if (!this.context) return false;

		try {
			const cookies = await this.context.cookies();
			const authCookie = cookies.find((c) => c.name === "authToken");
			return !!authCookie && !!authCookie.value;
		} catch (error) {
			return false;
		}
	}

	async verifySession() {
		if (!this.page) {
			console.log("❌ No page initialized");
			return false;
		}

		const loggedIn = await this.isLoggedIn();
		console.log(
			`🔑 Login status: ${loggedIn ? "Logged in" : "Not logged in"}`
		);

		if (loggedIn) {
			const cookies = await this.context!.cookies();
			const authCookie = cookies.find((c) => c.name === "authToken");
			console.log(
				"🍪 Auth token:",
				authCookie?.value?.substring(0, 20) + "..."
			);

			// Navigate to a page that requires auth to verify the session works
			await this.page.goto("https://snoonu.com/en/profile", {
				waitUntil: "networkidle",
			});

			// Check if we get redirected to login
			const url = this.page.url();
			if (url.includes("profile")) {
				console.log(
					"✅ Session is valid - able to access profile page"
				);
				return true;
			} else {
				console.log(
					"⚠️ Session invalid - redirected away from profile"
				);
				return false;
			}
		}

		return false;
	}

	async clearSession() {
		console.log("🗑️ Clearing saved session...");
		try {
			await fs.unlink(this.sessionFile);
			console.log("✅ Session cleared");
		} catch (error) {
			console.log("No session to clear");
		}
	}

	async cleanup() {
		console.log("🧹 Cleaning up...");

		if (this.loginCheckInterval) {
			clearInterval(this.loginCheckInterval);
		}

		await this.saveSession();

		if (this.browser) {
			await this.browser.close();
		}

		console.log("✅ Cleanup complete");
	}

	// Getter for direct page access if needed
	getPage(): Page | null {
		return this.page;
	}
}

// Example usage
async function main() {
	const automation = new SnoonuAutomation();

	try {
		await automation.initialize();

		// Navigate to Snoonu
		await automation.navigateTo("https://snoonu.com");

		// await automation.REPL();
		// prompt user for item to search for
		// const searchItem = await automation.promptUser(
		// 	"Enter item to search for (e.g., 'coffee'): "
		// );
		const searchItem = "Coffee";

		if (!searchItem) {
			console.log("No item specified, exiting...");
			return;
		}

		// const results = await automation.searchProducts(
		// 	[
		// 		{
		// 			term: "gluten free oats",
		// 			category: "Groceries",
		// 			amount: "1kg",
		// 		},
		// 		{ term: "honey", category: "Groceries", amount: "1kg" },
		// 		{ term: "carrots", category: "Groceries", amount: "1kg" },
		// 		{ term: "tomato", category: "Groceries", amount: "1kg" },
		// 		{
		// 			term: "chicken breasts",
		// 			category: "Groceries",
		// 			amount: "1kg",
		// 		},
		// 	],
		// 	"Everywhere",
		// 	false
		// );

		const query = await queryOpenRouter(
			// `give me a grocery cart for a fodmap diet,
			// enough to make breakfast, lunch, and dinner,
			// items should be proably available in qatar,
			// 1 week supply,
			// as well as snacks,
			// the terms should be specific ITEMS (e.g eggs, chicken, potato, etc...)`
			`give me a grocery cart for maximum weight loss while staying satiated,
			enough to make breakfast, lunch, snacks, and dinner,
			I have hypothyroidism,
			no eggs, dairy, gluten, or nuts,
			items should be available in qatar,
			1 week supply,
			as well as snacks,
			the terms should be specific ITEMS (e.g eggs, chicken, potato, etc...), no extra notes/brackets`,
			object({
				notes: string(),
				queries: array(
					object({
						term: string(),
						amount: string(),
					})
				),
				recipes: array(
					object({
						day: string(),
						breakfast: string(),
						lunch: string(),
						snacks: string(),
						dinner: string(),
					})
				),
			}),
			{
				model: "x-ai/grok-code-fast-1",
			}
		);

		// console.table(query.recipes);

		const results = await automation.searchProducts(
			query.queries.map((q) => ({ ...q, category: "Groceries" }))
		);

		// const results = await automation.searchProducts([
		// 	// { term: "quinoa", category: "Groceries", amount: "500g" },
		// 	// { term: "snow peas", category: "Groceries", amount: "500g" },
		// 	// { term: "asparagus", category: "Groceries", amount: "500g" },
		// 	// { term: "mushrooms", category: "Groceries", amount: "500g" },
		// 	{ term: "onions", category: "Groceries", amount: "500g" },
		// 	{ term: "garlic", category: "Groceries", amount: "500g" },
		// ]);

		const grouped = results.reduce((result, item) => {
			item.merchants.forEach((merchant) => {
				if (!result[merchant.name]) {
					result[merchant.name] = {
						average_preparation_time:
							merchant.average_preparation_time,
						is_free_delivery_eligible:
							merchant.is_free_delivery_eligible,
						min_eta: merchant.min_eta,
						items: merchant.items,
					};
				} else {
					result[merchant.name]!.items.push(...merchant.items);
				}
			});
			return result;
		}, {} as { [merchant: string]: Pick<Merchant, "items" | "min_eta" | "is_free_delivery_eligible" | "average_preparation_time"> });

		async function chooseItemsWithLLM({
			items,
			preferences,
			maxMerchants = 2,
			minRelevance = 0.2,
		}: {
			items: {
				query: {
					term: string;
					category?: keyof typeof SNOONU_CATEGORIES;
					amount?: number | string;
				};
				merchants: Merchant[];
			}[];
			preferences: string[];
			maxMerchants?: number;
			minRelevance?: number;
		}) {
			const simplified = Object.entries(items)
				.map(([_, data]) => ({
					query: data.query,
					merchants: data.merchants.map((merchant) => ({
						merchant,
						...merchant,
						items: merchant.items
							.filter((i) => (i.relevance_score ?? 0) > minRelevance)
							.map((item) => ({
								id: item.id,
								name: item.name,
								price: Math.min(
									item.price,
									item.discounted_price ?? 9999999
								),
							}))
							.sort((a, b) => a.price - b.price),
					})),
				}))
				.filter((m) => m.merchants.length > 0);
			const result = await queryOpenRouter(
				`
				The user has queries the marketplace AI for the following grocery items, here are
				the queries as well as their results (query -[1]-> merchant -[1..*]-> items)
				${simplified.map(
					({ query, merchants }) => `
					query: ${query.term} - ${query.amount}
				${merchants
					.map(
						({ merchant, items }) => `
					[${merchant.name}]: {

					items: ${items
						.map(
							({ id, name, price }) =>
								`[${id}] ${name} (${price} QR)`
						)
						.join(", ")}
					}
				`
					)
					.join("\n")}
				`
				)}

				The user has expressed some preferences regarding picking items:
				${preferences.map((pref) => `- ${pref}`).join("\n")}

				# GENERAL RULES:
				- return the ids for the items to add to cart
				- the max amount of merchants is ${maxMerchants}
				- optimize the cart for the least amount of deliveries possible:
					* for each item, get the exact item, not a similar item.
					* Note that each merchant delivery costs 10 QAR.
					* if more than ${maxMerchants} merchants, get the most items from the cheapest subtotal merchant.
					* if only 1 merchant, get the most items from that merchant.
					* Do not get duplicate items.
					* Be smart about the quantities, if user requests 1KG and there's 500g, get 2 items.
				`,
				object({
					notes: string(),
					carts: array(
						object({
							merchant: string(),
							relevant_items: array(
								object({
									id: string(),
									name: string(),
									quantity: number(),
								})
							),
						})
					),
					missing: array(string()),
				}),
				{
					model: "google/gemini-2.5-flash",
				}
			);

			console.log(result);
			return result;
		}

		const llm_query = await chooseItemsWithLLM({
			items: results,
			maxMerchants: 2,
			preferences: [],
		});

		const result: {
			id: string;
			quantity: number;
			product: Product;
		}[] = [];
		for (const cart of llm_query.carts) {
			const final_result = grouped[cart.merchant]!.items.filter(
				(item) =>
					!!item.id &&
					!!item.product &&
					cart.relevant_items.map((i) => i.id).includes(item.id)
			).map((item) => ({
				id: item.id!,
				quantity: cart.relevant_items
					.filter((i) => i.id === item.id)
					.at(0)!.quantity,
				product: item.product!,
			}));
			result.push(...final_result);
		}

		await addItemsToCart(result);

		async function addItemsToCart(
			items: {
				id: string;
				quantity: number;
				product: Product;
			}[]
		) {
			// Set up response listener BEFORE making the request
			const data: SyncCartRequest = {
				items: items.map((item) => ({
					product_identity: {
						product_id: item.id,
						choice_item_ids: [],
						special_request: "",
					},
					quantity: item.quantity,
				})),
			};
			const page = automation.getPage();
			if (page) {
				const responsePromise = page.waitForResponse((response) =>
					response.url().includes("/api/v1/multicart/sync")
				);

				// Make the request in browser context
				const resultPromise = page.evaluate(
					async ({ data, items }) => {
						const deviceId =
							localStorage.getItem("snoonu-app-device-id") ||
							"web-b741f08b596dfbba55b94f93d08ea032";
						const token = localStorage.getItem("token") || "";

						const headers = {
							accept: "*/*",
							"content-type": "application/json",
							appversion: "2",
							language: "en",
							latitude: "25.30015325558983",
							longitude: "51.49286493659019",
							"snoonu-app-device-id": deviceId,
							"snoonu-app-platform": "Web",
							"snoonu-app-version": "65535.65535.65535.65535",
							token: token,
						};

						const response = await fetch(
							"https://snoomarket-web.snoonu.com/api/v1/multicart/sync",
							{
								method: "POST",
								headers,
								body: JSON.stringify(data),
								mode: "cors",
								credentials: "omit",
							}
						);

						await fetch(
							"https://admin.snoonu.com/api/v5/orders/open",
							{
								headers,
								referrer: "https://snoonu.com/",
								body: null,
								method: "GET",
								mode: "cors",
								credentials: "include",
							}
						);

						const cartProducts = items.reduce((acc, item, i) => {
							acc[`_${item.id}`] = {
								isDeleted: false,
								isInstock: true,
								imageUrl: item.product.image_url,
								additionalRequired: 0,
								businessUnitId:
									item.product.business_unit_main_category_id,
								name: item.product.name,
								englishName: item.product.name,
								id: i,
								productId: item.id,
								businessUnitMainCategoryId:
									item.product.business_unit_main_category_id,
								images: [item.product.image_url],
								price: item.product.price.toString(),
								minPrice: parseFloat(item.product.price),
								basePrice: parseFloat(item.product.price),
								description: item.product.description || "",
								stockCount: item.product.stock_count,
								discount: 0,
								isAvailable: true,
								count: item.quantity,
								notes: "",
								uuid: `_${item.id}`,
								totalPrice:
									parseFloat(item.product.price) *
									item.quantity,
								selectedAdditional: [],
								lastAddedIndex: 0,
								productMerchant: null,
								additionalData: item.product.additional_data,
								merchantId: item.product.merchant_id,
								businessUnitName:
									item.product.business_unit_main_category_id,
								hasBuyOneGetOne:
									item.product.has_buy_one_get_one,
								marketPlaceDiscount:
									item.product.market_place_discount,
								marketPlacePrice:
									item.product.market_place_price,
								marketplaceMainCategories:
									item.product.marketplace_main_categories,
								marketplaceSubCategories:
									item.product.marketplace_sub_categories,
								marketplaceProductGroups:
									item.product.marketplace_product_groups,
								notRoundedDiscount:
									item.product.not_rounded_discount,
								productOrderLimit:
									item.product.product_order_limit,
								promoted: item.product.promoted,
								productTags: item.product.product_tags,
								urlFriendlyName: item.product.url_friendly_name,
								vertical: item.product.vertical,
							} satisfies CartItem;
							return acc;
						}, {} as Record<string, any>);

						localStorage.setItem(
							"marketplaceCartProducts",
							JSON.stringify(cartProducts)
						);
						localStorage.setItem(
							"marketplaceCartIsShown",
							'"true"'
						);

						// Try to access MobX store and update it directly (may not work)
						try {
							// NextJS stores initial state here
							const nextData = (window as any).__NEXT_DATA__;
							if (
								nextData?.props?.pageProps?.initialState
									?.marketplaceCartStore
							) {
								const store =
									nextData.props.pageProps.initialState
										.marketplaceCartStore;
								store.cartProducts = cartProducts;
							}
						} catch (e) {
							console.log(
								"Could not update MobX store directly, will reload"
							);
						}

						return await response.json();
					},
					{ data, items }
				);

				// Wait for both
				const [response, result] = await Promise.all([
					responsePromise,
					resultPromise,
				]);

				// Now you can inspect the response
				console.log("Status:", response.status());
				console.log("Headers:", response.headers());
				console.log("Body:", await response.json());

				await page.goto("https://snoonu.com/checkout");
				return result;
			}
		}

		// simulate random click

		// Example: Search for a product
		// await automation.searchProduct('coffee');

		// Example: Click on restaurants
		// await automation.performAction(async () => {
		//   const page = automation.getPage();
		//   if (page) {
		//     await page.click('text="Restaurants"');
		//   }
		// });

		// Keep running (you can perform any actions)
		console.log("🎮 Automation running. Press Ctrl+C to exit.");
		console.log(
			"The login flow will be handled automatically when needed."
		);

		// Keep the script running
		await new Promise(() => {}); // This will run indefinitely
	} catch (error) {
		console.error("Error:", error);
	}
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n👋 Shutting down gracefully...");
	process.exit(0);
});

// Run if this is the main module

main().catch(console.error);

// Export for use as a module
export { SnoonuAutomation };
export default SnoonuAutomation;
