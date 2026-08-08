// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

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

let chromiumExtra: any;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

async function loadPlaywright() {
	if (chromiumExtra) return;
	try {
		const { chromium } = await import("playwright-extra");
		const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
		chromium.use(StealthPlugin());
		chromiumExtra = chromium;
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

	try {
		browser = await chromiumExtra.launch({
			headless: process.env.HEADLESS !== "false",
		});
	} catch (err: any) {
		if (err?.message?.includes("Executable doesn't exist")) {
			throw new Error(
				"Chromium browser is not installed. Run this command to install it: npx playwright install chromium — then retry the operation."
			);
		}
		throw err;
	}
	if (!browser) {
		throw new Error(
			"Failed to launch Chromium — the browser handle was null after launch. Try `npx playwright install chromium`.",
		);
	}

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
		// domcontentloaded fires before this Next.js app hydrates; interactive
		// elements (loginBtn, the header) are not wired up yet. Wait for the
		// header to actually exist rather than racing it.
		await p
			.locator('[data-test-id="loginBtn"], [data-test-id="locationBtnOnHeader"]')
			.first()
			.waitFor({ state: "visible", timeout: 30000 })
			.catch(() => {});
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

		// Dismiss the location modal BEFORE clicking login. It renders on top of
		// the header and swallows the click, which left the login modal closed
		// and the phone field never present.
		await dismissLocationModal(p);

		// Click login button - try data-test-id first, fall back to text
		try {
			await p.locator('[data-test-id="loginBtn"]').click({ timeout: 5000 });
		} catch {
			// Fall back to finding button by text
			await p.locator('button:has-text("Login")').first().click({ timeout: 5000 });
		}
		// Enter phone number. Prefer the stable test id — `input[type="tel"]`
		// also matches the OTP field, so ordering was fragile.
		//
		// Do NOT call dismissLocationModal() here. confirmLocationBtn /
		// crossIconBtn live in the same modal component tree as the login form
		// and only enter the DOM once the login modal opens; clicking one at
		// this point swaps the login modal for the address picker and the phone
		// field never appears.
		const phoneInput = p
			.locator('[data-test-id="phoneInputField"], input[type="tel"]')
			.first();
		try {
			await phoneInput.waitFor({ state: "visible", timeout: 15000 });
		} catch {
			// Login modal never opened — a blocking overlay is the usual cause.
			// Dismiss it and click login once more before giving up.
			await dismissLocationModal(p);
			await p
				.locator('[data-test-id="loginBtn"]')
				.click({ timeout: 5000 })
				.catch(() => {});
			await phoneInput.waitFor({ state: "visible", timeout: 15000 });
		}
		// The login modal renders an address/map picker whose loading skeleton
		// (MapLoading-module…__loading) sits above the form and swallows pointer
		// events, so .click() retries until it times out. Wait for the skeleton
		// to go away, then fill() — fill focuses via the DOM and does not
		// hit-test, so it works even if something is still overlaying.
		await p
			.locator('[class*="MapLoading"][class*="loading"], [class*="Skeleton"]')
			.first()
			.waitFor({ state: "detached", timeout: 15000 })
			.catch(() => {});
		await phoneInput.fill(phoneNumber);

		// Click continue. The same overlay that blocks the phone field can block
		// this, so fall back to a forced click and then a DOM-level click.
		const continueBtn = p
			.locator('[data-test-id="btnContinueLogin"], button:has-text("Continue")')
			.first();
		try {
			await continueBtn.click({ timeout: 5000 });
		} catch {
			try {
				await continueBtn.click({ timeout: 5000, force: true });
			} catch {
				await continueBtn.evaluate((el) => (el as HTMLElement).click());
			}
		}

		// Wait for the OTP screen specifically. This used to wait for
		// `input[type="tel"]`, which the PHONE field already satisfies — so it
		// reported "OTP sent" even when the request never went through.
		// Verified against the live DOM: the OTP field is
		// data-test-id="pinInputField" (name="pin", autocomplete="one-time-code").
		await p
			.locator('[data-test-id="pinInputField"], input[name="pin"]')
			.first()
			.waitFor({ state: "visible", timeout: 30000 });

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

		// Target the OTP field explicitly. `input[type="tel"]).first()` was
		// ambiguous — on some screens it resolves to the phone field instead.
		const otpInput = p
			.locator('[data-test-id="pinInputField"], input[name="pin"], input[type="tel"]')
			.first();
		await otpInput.waitFor({ state: "visible", timeout: 10000 });
		await otpInput.fill("");
		// Type rather than fill: the field is a controlled React input that only
		// submits once it sees per-character input events.
		await otpInput.type(otpCode, { delay: 120 });

		// Wait for login to complete (login button disappears or modal closes)
		await p.waitForTimeout(6000);

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
 * Sync cart to the Snoonu backend from within the browser context.
 * This ensures the cart is registered under the browser's cookie session
 * (which is what the SSR checkout page reads). Without this, the cart
 * added via Node.js fetch() may not be visible to the checkout page.
 */
export async function syncCartViaBrowser(
	items: Array<{ productId: string; quantity: number }>,
	headers: Record<string, string>
): Promise<void> {
	const p = await connectBrowser();

	if (!p.url().includes("snoonu.com")) {
		await p.goto("https://snoonu.com", { waitUntil: "domcontentloaded" });
	}

	await p.evaluate(
		async ({ apiUrl, hdrs, syncItems }) => {
			await fetch(apiUrl, {
				method: "POST",
				headers: hdrs,
				body: JSON.stringify({
					items: syncItems.map((item: any) => ({
						product_identity: {
							product_id: item.productId,
							choice_item_ids: [],
							special_request: "",
						},
						quantity: item.quantity,
					})),
				}),
				credentials: "omit",
			});
			// Also fire orders/open to activate cart server-side
			fetch(hdrs._ordersOpenUrl || "", {
				headers: hdrs,
				method: "GET",
				credentials: "omit",
			}).catch(() => {});
		},
		{
			apiUrl: "https://snoomarket-web.snoonu.com/api/v1/multicart/sync",
			hdrs: { ...headers, _ordersOpenUrl: "https://admin.snoonu.com/api/v5/orders/open" },
			syncItems: items,
		}
	);
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
async function dismissLocationModal(p: Page): Promise<boolean> {
	// Snoonu is location-gated: until this modal is resolved, the delivery
	// location is unset and catalogue/search requests come back empty. The old
	// selectors ('button:has-text("Confirm location")' and
	// '[class*="Modal_cross"], [aria-label="Close"]') no longer exist in the
	// live DOM, so the modal was never dismissed and searches silently
	// returned nothing. Verified against snoonu.com — the real hooks are
	// data-test-id="confirmLocationBtn" / "crossIconBtn" / "crossXBtn".
	const confirmSelectors = [
		'[data-test-id="confirmLocationBtn"]',
		'button:has-text("Confirm location")',
		'button:has-text("Confirm")',
	];
	const closeSelectors = [
		'[data-test-id="crossIconBtn"]',
		'[data-test-id="crossXBtn"]',
		'[class*="Modal_cross"]',
		'[aria-label="Close"]',
	];

	for (const sel of [...confirmSelectors, ...closeSelectors]) {
		try {
			const el = p.locator(sel).first();
			if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
				await el.click({ timeout: 3000 });
				await p.waitForTimeout(600);
				return true;
			}
		} catch {
			// try the next selector
		}
	}
	return false;
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
 * Scrape payment methods from the checkout page.
 * Reads the radiogroup[name="paymentMethod"] inputs.
 */
export async function getPaymentMethods(): Promise<{
	success: boolean;
	methods: Array<{ index: number; value: string; label: string; selected: boolean }>;
	message: string;
}> {
	try {
		const p = await connectBrowser();

		if (!p.url().includes("/checkout")) {
			return { success: false, methods: [], message: "Not on checkout page. Call go_to_checkout first." };
		}

		const methods = await p.evaluate(() => {
			const radios = document.querySelectorAll<HTMLInputElement>('input[name="paymentMethod"]');
			return Array.from(radios).map((radio, i) => {
				const label = radio.closest("label");
				const texts = label
					? Array.from(label.querySelectorAll("p"))
						.map((p) => p.textContent?.trim())
						.filter(Boolean)
						.join(" — ")
					: radio.value;
				return {
					index: i,
					value: radio.value,
					label: texts || radio.value,
					selected: radio.checked,
				};
			});
		});

		return { success: true, methods, message: `Found ${methods.length} payment methods.` };
	} catch (error) {
		return {
			success: false,
			methods: [],
			message: `Failed to get payment methods: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Select a payment method by its index in the radiogroup.
 */
export async function selectPaymentMethod(index: number): Promise<{
	success: boolean;
	message: string;
}> {
	try {
		const p = await connectBrowser();

		if (!p.url().includes("/checkout")) {
			return { success: false, message: "Not on checkout page. Call go_to_checkout first." };
		}

		const result = await p.evaluate((idx) => {
			const radios = document.querySelectorAll<HTMLInputElement>('input[name="paymentMethod"]');
			if (idx < 0 || idx >= radios.length) {
				return { ok: false, msg: `Index ${idx} out of range (0-${radios.length - 1})` };
			}
			const label = radios[idx]!.closest("label");
			if (label) {
				label.click();
			} else {
				radios[idx]!.click();
			}
			return { ok: true, msg: `Selected: ${radios[idx]!.value}` };
		}, index);

		if (!result.ok) return { success: false, message: result.msg };
		return { success: true, message: result.msg };
	} catch (error) {
		return {
			success: false,
			message: `Failed to select payment method: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Click the "Place order" button on the checkout page.
 * Uses data-test-id="placeOrderBtn" selector from the actual Snoonu DOM.
 */
export async function clickPlaceOrder(): Promise<{
	success: boolean;
	message: string;
	url: string;
}> {
	const p = await connectBrowser();

	if (!p.url().includes("/checkout")) {
		return { success: false, message: "Not on checkout page. Call go_to_checkout first.", url: p.url() };
	}

	const placeBtn = p.locator('[data-test-id="placeOrderBtn"]');
	const isVisible = await placeBtn.isVisible({ timeout: 3000 }).catch(() => false);
	if (!isVisible) {
		return { success: false, message: "Place order button not found on the page.", url: p.url() };
	}

	const isDisabled = await placeBtn.isDisabled().catch(() => true);
	if (isDisabled) {
		return {
			success: false,
			message: "Place order button is disabled. Ensure a payment method is selected and address details are filled in.",
			url: p.url(),
		};
	}

	await placeBtn.click();

	// Wait for navigation away from checkout (order confirmation or error)
	try {
		await p.waitForURL((url) => !url.toString().includes("/checkout"), { timeout: 30000 });
	} catch {
		// May stay on same page with error
	}

	await p.waitForTimeout(2000);
	const finalUrl = p.url();

	if (finalUrl.includes("/order") || finalUrl.includes("/tracking")) {
		return { success: true, message: "Order placed successfully!", url: finalUrl };
	}

	// Previously this compared against the literal "https://snoonu.com/checkout".
	// Any locale prefix or query string (e.g. /en/checkout, /checkout?step=2)
	// made that comparison false, so a checkout page that never navigated was
	// reported as a successful order. Check whether we are still on ANY
	// checkout URL instead.
	if (!finalUrl.includes("/checkout")) {
		return { success: true, message: "Order submitted.", url: finalUrl };
	}

	return {
		success: false,
		message:
			"Order was not placed — the page stayed on checkout. Check that a payment method is selected and the address is complete.",
		url: finalUrl,
	};
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
