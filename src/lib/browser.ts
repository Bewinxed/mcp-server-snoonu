/**
 * Browser Layer for Snoonu MCP Server
 * Launches a Playwright-managed Chromium instance for login/OTP and checkout.
 *
 * Playwright is lazy-loaded so the bundler doesn't try to inline it
 * and the server starts fast for non-browser operations.
 */

import type { Browser, BrowserContext, Page } from "playwright";
import {
	updateSessionFromBrowser,
	loadSession,
	type CookieData,
	type SnoonuSession,
} from "./session-manager";

let chromium: typeof import("playwright").chromium;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

async function loadPlaywright() {
	if (chromium) return;
	try {
		const pw = await import("playwright");
		chromium = pw.chromium;
	} catch {
		throw new Error(
			"Playwright is required for browser features (login, checkout).\n" +
			"Install it with: npx playwright install chromium"
		);
	}
}

/**
 * Launch a Playwright-managed Chromium instance.
 * Restores session cookies if a saved session exists.
 */
export async function connectBrowser(): Promise<Page> {
	if (page && !page.isClosed()) return page;

	await loadPlaywright();

	browser = await chromium.launch({ headless: false });
	context = await browser.newContext();

	// Restore saved session cookies so the browser is already logged in
	const session = await loadSession();
	if (session?.cookies?.length) {
		await context.addCookies(
			session.cookies.map((c) => ({
				name: c.name,
				value: c.value,
				domain: c.domain,
				path: c.path,
				expires: c.expires,
				httpOnly: c.httpOnly,
				secure: c.secure,
				sameSite: c.sameSite,
			}))
		);
	}

	page = await context.newPage();
	return page;
}

/**
 * Navigate to Snoonu and dismiss any popups.
 */
export async function navigateToSnoonu(): Promise<void> {
	const p = await connectBrowser();

	if (!p.url().includes("snoonu.com")) {
		await p.goto("https://snoonu.com", { waitUntil: "domcontentloaded" });
	}

	// Dismiss location modal if present
	await dismissLocationModal(p);
}

/**
 * Start OTP login flow.
 * Navigates to snoonu.com, clicks login, enters phone number.
 */
export async function requestOtp(phoneNumber: string): Promise<{ success: boolean; message: string }> {
	try {
		const p = await connectBrowser();
		await navigateToSnoonu();

		// Click login button - try data-test-id first, fall back to text
		try {
			await p.locator('[data-test-id="loginBtn"]').click({ timeout: 3000 });
		} catch {
			// Fall back to finding button by text
			await p.locator('button:has-text("Login")').first().click({ timeout: 3000 });
		}
		await p.waitForTimeout(500);

		// Dismiss location modal if it appeared
		await dismissLocationModal(p);

		// Enter phone number
		const phoneInput = p.locator('input[type="tel"]').first();
		await phoneInput.waitFor({ state: "visible", timeout: 5000 });
		await phoneInput.click();
		await phoneInput.fill(phoneNumber);

		// Click continue button
		try {
			await p.locator('[data-test-id="btnContinueLogin"]').click({ timeout: 3000 });
		} catch {
			await p.locator('button:has-text("Continue")').first().click({ timeout: 3000 });
		}

		// Wait for OTP input to appear
		await p.locator('input[type="tel"]').first().waitFor({ state: "visible", timeout: 30000 });

		return { success: true, message: "OTP sent. Enter the 6-digit code." };
	} catch (error) {
		return {
			success: false,
			message: `Failed to request OTP: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Verify OTP code and extract session.
 */
export async function verifyOtp(otpCode: string): Promise<{
	success: boolean;
	loggedIn: boolean;
	session: SnoonuSession | null;
	message: string;
}> {
	try {
		const p = await connectBrowser();

		// Find OTP input and fill it
		const otpInput = p.locator('input[type="tel"]').first();
		await otpInput.waitFor({ state: "visible", timeout: 5000 });
		await otpInput.fill(otpCode);

		// Wait for login to complete (login button disappears or modal closes)
		await p.waitForTimeout(3000);

		// Extract session from browser
		const session = await extractSessionFromBrowser(p);

		if (session && session.authToken) {
			return {
				success: true,
				loggedIn: true,
				session,
				message: "Login successful",
			};
		}

		return {
			success: true,
			loggedIn: false,
			session: null,
			message: "OTP verified but auth token not found. Login may still be in progress.",
		};
	} catch (error) {
		return {
			success: false,
			loggedIn: false,
			session: null,
			message: `Failed to verify OTP: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Extract auth session from browser cookies and localStorage.
 */
async function extractSessionFromBrowser(p: Page): Promise<SnoonuSession | null> {
	if (!context) return null;

	const cookies = await context.cookies();

	const deviceId = await p.evaluate(() => {
		const raw = localStorage.getItem("deviceId");
		if (raw) {
			try { return JSON.parse(raw); } catch { return raw; }
		}
		return localStorage.getItem("snoonu-app-device-id") || null;
	});

	const cookieData: CookieData[] = cookies.map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		expires: c.expires,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite as "Strict" | "Lax" | "None",
	}));

	return updateSessionFromBrowser(cookieData, deviceId || undefined);
}

/**
 * Navigate to checkout page.
 */
export async function goToCheckout(): Promise<{
	success: boolean;
	url: string;
	message: string;
}> {
	try {
		const p = await connectBrowser();
		await p.goto("https://snoonu.com/checkout", {
			waitUntil: "domcontentloaded",
		});

		return {
			success: true,
			url: "https://snoonu.com/checkout",
			message: "Navigated to checkout page.",
		};
	} catch (error) {
		return {
			success: false,
			url: "",
			message: `Failed to navigate to checkout: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Dismiss the location confirmation modal if present.
 */
async function dismissLocationModal(p: Page): Promise<void> {
	try {
		// Try to find and click "Confirm location" button
		const confirmBtn = p.locator('button:has-text("Confirm location")');
		if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await confirmBtn.click();
			await p.waitForTimeout(500);
			return;
		}

		// Try close button with various selectors
		const closeBtn = p.locator('[class*="Modal_cross"], [aria-label="Close"]').first();
		if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
			await closeBtn.click();
			await p.waitForTimeout(500);
		}
	} catch {
		// Modal not present
	}
}

/**
 * Sync cart state to browser localStorage so Next.js frontend sees it.
 */
export async function syncCartToLocalStorage(
	cartItems: Array<{
		productId: string;
		merchantId: number;
		name: string;
		imageUrl: string;
		price: number;
		quantity: number;
		totalPrice: number;
		isAvailable: boolean;
	}>
): Promise<boolean> {
	try {
		const p = await connectBrowser();

		// Ensure we're on snoonu.com (localStorage is per-origin)
		if (!p.url().includes("snoonu.com")) {
			await p.goto("https://snoonu.com", { waitUntil: "domcontentloaded" });
		}

		await p.evaluate((items) => {
			if (items.length === 0) {
				localStorage.removeItem("marketplaceCartProducts");
				localStorage.setItem("marketplaceCartIsShown", '"false"');
				return;
			}

			const cartProducts: Record<string, any> = {};
			for (let i = 0; i < items.length; i++) {
				const item = items[i]!;
				const key = `_${item.productId}`;
				cartProducts[key] = {
					isDeleted: false,
					isInstock: item.isAvailable,
					imageUrl: item.imageUrl,
					additionalRequired: 0,
					businessUnitId: "",
					businessUnitName: "",
					name: item.name,
					englishName: item.name,
					id: i,
					productId: item.productId,
					businessUnitMainCategoryId: "",
					images: [item.imageUrl],
					price: item.price.toString(),
					minPrice: item.price,
					basePrice: item.price,
					marketPlacePrice: item.price,
					marketPlaceDiscount: 0,
					description: "",
					stockCount: 99,
					discount: 0,
					notRoundedDiscount: 0,
					isAvailable: item.isAvailable,
					count: item.quantity,
					notes: "",
					uuid: key,
					totalPrice: item.totalPrice,
					selectedAdditional: [],
					lastAddedIndex: 0,
					productMerchant: null,
					additionalData: [],
					merchantId: item.merchantId,
					hasBuyOneGetOne: false,
					marketplaceMainCategories: [],
					marketplaceSubCategories: [],
					marketplaceProductGroups: [],
					promoted: 0,
					productOrderLimit: 0,
					productTags: {},
					urlFriendlyName: null,
					vertical: 0,
				};
			}

			localStorage.setItem(
				"marketplaceCartProducts",
				JSON.stringify(cartProducts)
			);
			localStorage.setItem("marketplaceCartIsShown", '"true"');

			// Try to update MobX store directly for immediate reactivity
			try {
				const nextData = (window as any).__NEXT_DATA__;
				if (nextData?.props?.pageProps?.initialState?.marketplaceCartStore) {
					nextData.props.pageProps.initialState.marketplaceCartStore.cartProducts =
						cartProducts;
				}
			} catch {
				// MobX store update is best-effort
			}
		}, cartItems);

		return true;
	} catch {
		// Browser not available — cart is still synced server-side via API
		return false;
	}
}

/**
 * Sync delivery location to browser cookie so Next.js frontend uses it.
 */
export async function syncLocationToBrowser(
	addressId: number,
	name: string,
	latitude: number,
	longitude: number
): Promise<boolean> {
	try {
		const p = await connectBrowser();

		if (!p.url().includes("snoonu.com")) {
			await p.goto("https://snoonu.com", { waitUntil: "domcontentloaded" });
		}

		await p.evaluate(
			({ id, name, lat, lng }) => {
				const token = JSON.stringify({
					id,
					name,
					coordinates: { lat, lng },
				});
				document.cookie = `locationToken=${encodeURIComponent(token)};path=/;domain=snoonu.com`;
				document.cookie = `locationUserConfirm=true;path=/;domain=snoonu.com`;
			},
			{ id: addressId, name, lat: latitude, lng: longitude }
		);

		// Reload to pick up new location
		await p.reload({ waitUntil: "domcontentloaded" });

		return true;
	} catch {
		// Browser not available — location is still set via API headers
		return false;
	}
}

/**
 * Clean up browser connection.
 */
export async function closeBrowser(): Promise<void> {
	if (browser) {
		await browser.close().catch(() => {});
		browser = null;
		context = null;
		page = null;
	}
}
