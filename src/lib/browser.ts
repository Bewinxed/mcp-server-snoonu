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
import { PerUser, currentUserId } from "../mcp/lib/user-context";

let chromiumExtra: any;
// Shared across all users — launching one Chromium process per user is very
// expensive and unnecessary; Playwright BrowserContexts provide full session
// isolation (separate cookies, storage, service workers) within a single process.
let browser: Browser | null = null;

const contexts = new PerUser<BrowserContext | null>(() => null);
const pages = new PerUser<Page | null>(() => null);

/** Timestamp of last connectBrowser() call per user, for idle eviction. */
const lastUsed = new Map<string, number>();

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Close and discard contexts that have been idle for longer than
 * IDLE_TIMEOUT_MS. Called on every connectBrowser() access — no setInterval
 * that would keep the process alive.
 */
function evictIdleContexts(): void {
	const now = Date.now();
	const self = currentUserId();
	for (const [userId] of contexts.entries()) {
		if (userId === self) continue;
		const ts = lastUsed.get(userId) ?? 0;
		if (now - ts <= IDLE_TIMEOUT_MS) continue;
		const ctx = contexts.get(userId);
		if (ctx) ctx.close().catch(() => {});
		contexts.delete(userId);
		pages.delete(userId);
		lastUsed.delete(userId);
	}
}

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
 *
 * The browser process is shared; each user gets their own BrowserContext
 * (separate cookies, storage, session) created on demand.
 */
export async function connectBrowser(): Promise<Page> {
	const userId = currentUserId();

	evictIdleContexts();

	const existingPage = pages.get(userId);
	if (existingPage && !existingPage.isClosed()) {
		lastUsed.set(userId, Date.now());
		return existingPage;
	}

	await loadPlaywright();

	if (!browser || !browser.isConnected()) {
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
	}

	const ctx = await browser.newContext();

	// Restore saved session cookies so the browser is already logged in
	const session = await loadSession();
	if (session?.cookies?.length) {
		await ctx.addCookies(
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

	const p = await ctx.newPage();
	contexts.set(ctx, userId);
	pages.set(p, userId);
	lastUsed.set(userId, Date.now());
	return p;
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
		// Opening login pops the "Set your location" modal ON TOP of the login
		// form. The phone field and Continue button are then visible to
		// Playwright but not clickable — every click is silently intercepted,
		// so the form never submits, no OTP request is sent, and the PIN screen
		// never appears, with no error shown anywhere.
		//
		// Confirming the location dismisses that overlay AND closes the login
		// modal with it, so login has to be reopened afterwards. The upside is
		// that the delivery location is now set, which the location-gated
		// search needs regardless.
		const phoneInput = p
			.locator('[data-test-id="phoneInputField"], input[type="tel"]')
			.first();

		for (let attempt = 0; attempt < 3; attempt++) {
			const blocked = await p
				.locator('[data-test-id="confirmLocationBtn"]')
				.first()
				.isVisible({ timeout: 1500 })
				.catch(() => false);

			if (!blocked) {
				const ready = await phoneInput
					.isVisible({ timeout: 4000 })
					.catch(() => false);
				if (ready) break;
			}

			await dismissLocationModal(p);
			await p
				.locator('[data-test-id="confirmLocationBtn"]')
				.first()
				.waitFor({ state: "detached", timeout: 8000 })
				.catch(() => {});

			// Reopen login — confirming the location closed it too.
			await p
				.locator('[data-test-id="loginBtn"]')
				.click({ timeout: 8000 })
				.catch(() => {});
			await p.waitForTimeout(2000);
		}

		await phoneInput.waitFor({ state: "visible", timeout: 20000 });
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

		// The phone field is a controlled React input. fill() sets the DOM value
		// but the component's state never updates, so Continue submits an empty
		// form: no validation error, no OTP request, and the PIN screen never
		// appears. focus() + per-character input makes React see it.
		await phoneInput.focus();
		await phoneInput.fill("");
		await phoneInput.pressSequentially(phoneNumber, { delay: 90 });

		const entered = await phoneInput.inputValue().catch(() => "");
		if (entered.replace(/\D/g, "") !== phoneNumber.replace(/\D/g, "")) {
			return {
				success: false,
				message: `Phone number did not register in the form (field shows "${entered}"). The login modal may have re-rendered mid-entry — retry.`,
			};
		}

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
	const ctx = contexts.get();
	if (!ctx) return null;

	const cookies = await ctx.cookies();

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
 * Fill the required delivery-detail fields on the checkout page.
 *
 * This is why place_order failed. The payment radios were never the problem —
 * `input[name="paymentMethod"]` is correct and returns 4 options (saved card,
 * google_pay, debit_card, cash) once the cart is non-empty. What actually keeps
 * `placeOrderBtn` disabled is that `addressName`, `buildingNumber` and
 * `numberOnDoor` are required and empty, and nothing could populate them.
 */
export async function fillDeliveryDetails(details: {
	name?: string;
	buildingNumber?: string;
	numberOnDoor?: string;
	driverNote?: string;
}): Promise<{ success: boolean; filled: string[]; message: string }> {
	const p = await connectBrowser();

	if (!p.url().includes("/checkout")) {
		return {
			success: false,
			filled: [],
			message: "Not on checkout page. Call go_to_checkout first.",
		};
	}

	const fields: Array<[keyof typeof details, string]> = [
		["name", '[data-test-id="name"]'],
		["buildingNumber", '[data-test-id="buildingNumberField"]'],
		["numberOnDoor", '[data-test-id="numberOnDoorField"]'],
		["driverNote", '[data-test-id="driverNote"]'],
	];

	const filled: string[] = [];
	for (const [key, selector] of fields) {
		const value = details[key];
		if (!value) continue;
		const el = p.locator(selector).first();
		if (!(await el.isVisible({ timeout: 3000 }).catch(() => false))) continue;
		// Controlled React inputs: type per character so component state updates.
		await el.focus();
		await el.fill("");
		await el.pressSequentially(value, { delay: 40 });
		filled.push(key);
	}

	await p.waitForTimeout(1200);

	const enabled = await p
		.locator('[data-test-id="placeOrderBtn"]')
		.first()
		.isEnabled()
		.catch(() => false);

	return {
		success: true,
		filled,
		message: enabled
			? "Delivery details saved. Place order is now enabled."
			: "Delivery details saved, but Place order is still disabled — a payment method may still need selecting.",
	};
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

		if (methods.length === 0) {
			// Reporting "found 0 methods" as a success is how this stayed
			// invisible: the payment section only renders once the cart has
			// items, so an empty cart looked like a working call returning
			// nothing.
			return {
				success: false,
				methods: [],
				message:
					"No payment methods on the page. The payment section only renders when the cart has items — check get_cart, and make sure go_to_checkout actually loaded the checkout page.",
			};
		}

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
 * Close the current user's browser context and page.
 * The shared browser process stays alive for other users.
 */
export async function closeBrowser(): Promise<void> {
	const userId = currentUserId();
	const ctx = contexts.has(userId) ? contexts.get(userId) : null;
	if (ctx) {
		await ctx.close().catch(() => {});
	}
	contexts.delete(userId);
	pages.delete(userId);
	lastUsed.delete(userId);
}

/**
 * Tear down every user's context and the shared browser process.
 * Call this on process shutdown only.
 */
export async function closeAllBrowsers(): Promise<void> {
	for (const [userId, ctx] of contexts.entries()) {
		if (ctx) await ctx.close().catch(() => {});
		contexts.delete(userId);
		pages.delete(userId);
		lastUsed.delete(userId);
	}
	if (browser) {
		await browser.close().catch(() => {});
		browser = null;
	}
}
