import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Cookie } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import type {
	BodyItem,
	MarketPlaceSearch,
} from "./types/snoonu/marketplace-search";
import type { GlobalSearch, Product } from "./types/snoonu/global-search";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SessionData {
	cookies: Cookie[];
	localStorage?: Record<string, string>;
	sessionStorage?: Record<string, string>;
}

let captured_data: Partial<GlobalSearch> = {};

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
			const session: SessionData = JSON.parse(
				await fs.readFile(this.sessionFile, "utf-8")
			);

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
			const session: SessionData = JSON.parse(
				await fs.readFile(this.sessionFile, "utf-8")
			);

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
		console.log("👀 Hovering over page...");
		await this.page.hover("body"); // Hover anywhere on page
	}

	async performAction(action: () => Promise<void>) {
		// This method wraps any action and ensures login is handled if needed
		if (!this.page) throw new Error("Page not initialized");

		try {
			await action();
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
				await action();
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

	async scrapeSearchProducts() {
		if (!this.page) return;
		type Merchant = {
			name: string;
			url: string;
			items: Item[];
		};

		type Item = {
			name: string;
			image?: string | null;
			price: number;
			url: string;
		};

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

		this.context?.setDefaultTimeout(1000);

		console.log(`🔍 Found ${merchants.length} merchants`);

		for (const merchant of merchants) {
			// SearchMerchant_info
			const info = merchant.locator('div[class*="SearchMerchant_info"]');
			if (!info) continue;
			// name SearchMerchant_name_***
			const name = await info
				.locator('[class*="SearchMerchant_name"]')
				.textContent();
			console.log(`{🛍️ Processing ${name}`);
			if (!name) continue;
			const url = await merchant.locator(">a").getAttribute("href");
			if (!url) continue;

			// SearchMerchant_carousel***
			const carousel = merchant.locator(
				'div[class*="SearchMerchant_carousel"]'
			);

			// productCard class
			const result: Merchant = {
				name,
				url,
				items: [],
			};
			const items = await carousel.locator(">div").all();
			console.log(`🔍 Found ${items.length} items for ${name}`);
			for (const item of items) {
				// const image = await item.locator(">img").getAttribute("src");
				// info ProductCartVerticalDescription_info__
				const info = await item.locator(
					'div[class*="ProductCartVerticalDescription_info"]'
				);
				const price = await info
					.locator('[class*="ProductCartVerticalDescription_price"]')
					.textContent()
					.catch(() => null);
				console.log(price);
				if (!price) continue;
				const name = await info
					.locator('[class*="ProductCartVerticalDescription_name"]')
					.textContent()
					.catch(() => null);
				console.log(name);
				if (!name) continue;
				const url = await item.getAttribute("href");
				if (!url) continue;
				result.items.push({
					name,
					// image,
					price: parseFloat(price),
					url,
				});
			}
			results.push(result);
		}

		console.log(results);
		return results;
	}

	async searchProduct(
		query: string,
		where: "Everywhere" | "Market" = "Everywhere"
	) {
		await this.performAction(async () => {
			if (!this.page) return;

			// this.page.route("**/_next/data/**/search.json*", async (route) => {

			// 	const response = await route.fetch();
			// 	const body = await response.body();
			// 	captured_data = JSON.parse(body.toString()) as {
			// 		pageProps: MarketPlaceSearch;
			// 	};
			// 	await route.fulfill({
			// 		json: captured_data,
			// 	});
			// });

			this.page.route("**/search/global*", async (route) => {
				console.log("📛 Intercepting global search");
				const response = await route.fetch();
				// clone response
				const body = await response.body();
				captured_data = JSON.parse(body.toString()) as GlobalSearch;
				await route.fulfill({
					json: captured_data,
				});
			});

			console.log(`🔍 Searching for: ${query}`);
			// set
			const whereDropdown = this.page.locator(
				"div[class*='SearchSelector_wrapper']"
			);
			if (whereDropdown) {
				await whereDropdown.click();
			}

			const option = whereDropdown
				.getByRole("listitem")
				.filter({ hasText: where })
				.first();
			if (!option) {
				console.error("No option found for:", where);
				return;
			}

			await option.click();

			const searchBox = this.page.locator('input[placeholder*="Search"]');
			await searchBox.click();
			await searchBox.fill(query);
			await searchBox.press("Enter");
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

		await automation.searchProduct(searchItem);

		const products = await automation.globalSearchScrapeProducts();
		console.log(products);

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
