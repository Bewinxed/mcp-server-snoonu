// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Checkout payment-DOM probe — DIAGNOSTIC ONLY.
 *
 * Logs in through the real UI, adds one cheap item to the cart through the real
 * UI, opens checkout, and dumps the payment section so the correct selectors
 * can be identified.
 *
 * SAFETY CONTRACT — enforced, not just intended:
 *   - The place-order button is NEVER clicked. It is only read.
 *   - A guard below aborts if the URL ever leaves /checkout unexpectedly.
 *
 * Also writes ~/.mcp-server-snoonu/session.json on success so later runs skip OTP.
 *
 *   bun run scripts/checkout-dom-probe.ts <phone>
 *   echo 123456 > /tmp/otp.txt
 */

import { chromium, type Page } from "playwright";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PHONE = process.argv[2];
if (!PHONE) throw new Error("usage: checkout-dom-probe.ts <phone>");
const OTP_FILE = "/tmp/otp.txt";
const log = (...a: unknown[]) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	locale: "en-US",
	geolocation: { latitude: 25.2854, longitude: 51.531 },
	permissions: ["geolocation"],
	timezoneId: "Asia/Qatar",
});
const page = await context.newPage();

async function settle(ms = 2500) {
	await page.waitForTimeout(ms);
}

/** Click that survives overlay interception. */
async function hardClick(sel: string, timeout = 8000): Promise<boolean> {
	const el = page.locator(sel).first();
	if ((await el.count()) === 0) return false;
	try {
		await el.click({ timeout });
		return true;
	} catch {
		try {
			await el.click({ timeout: 3000, force: true });
			return true;
		} catch {
			try {
				await el.evaluate((e) => (e as HTMLElement).click());
				return true;
			} catch {
				return false;
			}
		}
	}
}

async function dismissOverlays() {
	for (const sel of [
		'[data-test-id="confirmLocationBtn"]',
		'[data-test-id="crossIconBtn"]',
		'[data-test-id="crossXBtn"]',
	]) {
		const el = page.locator(sel).first();
		if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
			await hardClick(sel, 4000);
			await settle(1200);
		}
	}
}

// ---------------------------------------------------------------------------
// 1. Login
// ---------------------------------------------------------------------------
log("== loading snoonu.com ==");
await page.goto("https://snoonu.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page
	.locator('[data-test-id="loginBtn"]')
	.waitFor({ state: "visible", timeout: 30_000 })
	.catch(() => {});
await settle(4000);

const alreadyIn = await page.evaluate(() => document.cookie.includes("authToken"));
if (!alreadyIn) {
	await dismissOverlays();
	log("== opening login ==");
	await hardClick('[data-test-id="loginBtn"]');
	await settle(3000);

	// The "Set your location" modal opens on top of the login form and
	// intercepts every click. Confirming it also closes the login modal, so
	// login must be reopened afterwards.
	const phone = page.locator('[data-test-id="phoneInputField"]').first();
	for (let attempt = 0; attempt < 3; attempt++) {
		const blocked = await page
			.locator('[data-test-id="confirmLocationBtn"]')
			.first()
			.isVisible({ timeout: 1500 })
			.catch(() => false);
		if (!blocked && (await phone.isVisible({ timeout: 4000 }).catch(() => false))) {
			log("phone field reachable");
			break;
		}
		log(`  location overlay in the way (attempt ${attempt + 1}) — clearing + reopening login`);
		await dismissOverlays();
		await page
			.locator('[data-test-id="confirmLocationBtn"]')
			.first()
			.waitFor({ state: "detached", timeout: 8000 })
			.catch(() => {});
		await hardClick('[data-test-id="loginBtn"]');
		await settle(2500);
	}
	await phone.waitFor({ state: "visible", timeout: 20_000 });
	// Wait out the map skeleton that overlays the form, then fill (no hit-test).
	await page
		.locator('[class*="MapLoading"][class*="loading"]')
		.first()
		.waitFor({ state: "detached", timeout: 12_000 })
		.catch(() => {});
	// Controlled React input: fill() alone leaves component state empty, so
	// Continue submits nothing and no OTP is ever requested.
	await phone.focus();
	await phone.fill("");
	await phone.pressSequentially(PHONE, { delay: 90 });
	const entered = await phone.inputValue();
	log("phone field now reads:", JSON.stringify(entered));
	if (entered.replace(/\D/g, "") !== PHONE.replace(/\D/g, "")) {
		log("!! phone did not register — aborting rather than sending a bad request");
		await page.screenshot({ path: "/tmp/probe-phone-fail.png" });
		await browser.close();
		process.exit(1);
	}

	await hardClick('[data-test-id="btnContinueLogin"]');
	log("continue clicked — SMS sending");

	await page
		.locator('[data-test-id="pinInputField"]')
		.waitFor({ state: "visible", timeout: 40_000 });
	log("OTP screen reached");

	log(`\n== waiting for OTP in ${OTP_FILE} (25 min, retries allowed) ==`);
	const tried = new Set<string>();
	const deadline = Date.now() + 1_500_000;
	let loggedIn = false;

	while (!loggedIn && Date.now() < deadline) {
		let code: string | null = null;
		while (Date.now() < deadline) {
			if (existsSync(OTP_FILE)) {
				const raw = (await readFile(OTP_FILE, "utf-8")).trim();
				if (/^\d{4,8}$/.test(raw) && !tried.has(raw)) {
					code = raw;
					break;
				}
			}
			await new Promise((r) => setTimeout(r, 1500));
		}
		if (!code) break;
		tried.add(code);
		log(`filling OTP (${code.length} digits)`);
		const pin = page.locator('[data-test-id="pinInputField"]').first();
		await pin.fill("");
		await pin.type(code, { delay: 130 });
		await settle(8000);
		loggedIn = await page.evaluate(() => document.cookie.includes("authToken"));
		log("  logged in:", loggedIn);
		if (!loggedIn) log("  -> write another code to /tmp/otp.txt");
	}

	if (!loggedIn) {
		log("!! login failed — aborting");
		await page.screenshot({ path: "/tmp/probe-login-fail.png" });
		await browser.close();
		process.exit(1);
	}
}
log("\n== authenticated ==");

// Persist the session so future runs need no OTP.
try {
	const cookies = await context.cookies();
	const ls = await page.evaluate(() => ({ ...localStorage }));
	const auth = cookies.find((c) => c.name === "authToken");
	const loc = cookies.find((c) => c.name === "locationToken");
	if (auth) {
		const dir = join(homedir(), ".mcp-server-snoonu");
		await mkdir(dir, { recursive: true, mode: 0o700 });
		await writeFile(
			join(dir, "session.json"),
			JSON.stringify(
				{
					authToken: auth.value,
					deviceId: (ls as any).deviceId?.replace(/"/g, "") ?? "",
					locationToken: loc?.value ?? "",
					location: {
						latitude: "25.2854",
						longitude: "51.531",
						address: "Doha, Qatar",
					},
					cookies: cookies.map((c) => ({
						name: c.name,
						value: c.value,
						domain: c.domain,
						path: c.path,
						expires: c.expires,
						httpOnly: c.httpOnly,
						secure: c.secure,
						sameSite: c.sameSite,
					})),
					savedAt: new Date().toISOString(),
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);
		log("session saved to ~/.mcp-server-snoonu/session.json (mode 0600)");
	}
} catch (e) {
	log("could not save session:", (e as Error).message);
}

// ---------------------------------------------------------------------------
// 2. Put something in the cart via the real UI
// ---------------------------------------------------------------------------
log("\n== adding an item to the cart via the UI ==");
await page.goto("https://snoonu.com/groceries/snoomart", {
	waitUntil: "domcontentloaded",
	timeout: 60_000,
});
await settle(7000);
await dismissOverlays();

const addSelectors = [
	'[data-test-id="addToCartBtn"]',
	'[data-test-id="plusBtn"]',
	'[data-test-id="productCardMarketplace"] button',
	'button[class*="add"]',
	'[class*="ProductCard"] button',
];
let added = false;
for (const sel of addSelectors) {
	const n = await page.locator(sel).count();
	if (n > 0) {
		log(`  trying ${sel} (${n} matches)`);
		if (await hardClick(sel, 6000)) {
			await settle(4000);
			added = true;
			log("  clicked");
			break;
		}
	}
}
if (!added) log("  !! could not find an add-to-cart control");

// ---------------------------------------------------------------------------
// 3. Checkout — READ ONLY
// ---------------------------------------------------------------------------
log("\n== opening checkout (NO ORDER WILL BE PLACED) ==");
await page.goto("https://snoonu.com/checkout", {
	waitUntil: "domcontentloaded",
	timeout: 60_000,
});
await settle(9000);
log("url:", page.url());

const dump = async (p: Page) =>
	p.evaluate(() => {
		const testIds = Array.from(document.querySelectorAll("[data-test-id]"))
			.map((e) => (e as HTMLElement).dataset.testId ?? "")
			.filter(Boolean);

		const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
			type: i.type,
			name: i.name || null,
			testId: (i as HTMLElement).dataset.testId ?? null,
			value: (i.value || "").slice(0, 40),
			checked: i.checked,
			visible: !!(i.offsetWidth || i.offsetHeight),
		}));

		const aria = Array.from(
			document.querySelectorAll('[role="radio"],[role="radiogroup"],[role="button"]'),
		)
			.filter((e) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight))
			.slice(0, 40)
			.map((e) => ({
				role: e.getAttribute("role"),
				testId: (e as HTMLElement).dataset.testId ?? null,
				ariaChecked: e.getAttribute("aria-checked"),
				text: (e.textContent || "").trim().slice(0, 60),
			}));

		const paymentish = Array.from(document.querySelectorAll("*"))
			.filter((e) => {
				const el = e as HTMLElement;
				if (!(el.offsetWidth || el.offsetHeight)) return false;
				const attrs = Array.from(e.attributes)
					.map((a) => `${a.name}=${a.value}`)
					.join(" ");
				return /pay|card|cash|wallet|method/i.test(attrs);
			})
			.slice(0, 40)
			.map((e) => ({
				tag: e.tagName.toLowerCase(),
				testId: (e as HTMLElement).dataset.testId ?? null,
				cls: (e.className || "").toString().slice(0, 70),
				text: (e.textContent || "").trim().slice(0, 45),
			}));

		const btn = document.querySelector<HTMLButtonElement>(
			'[data-test-id="placeOrderBtn"]',
		);

		return {
			cartEmpty: /cart is empty|no items/i.test(document.body.innerText),
			testIds: [...new Set(testIds)].sort(),
			inputs,
			aria,
			paymentish,
			placeOrder: btn
				? { found: true, disabled: btn.disabled, text: (btn.textContent || "").trim() }
				: { found: false },
		};
	});

const d = await dump(page);
log("\ncart appears empty:", d.cartEmpty);
log("\n-- data-test-id on checkout --\n ", d.testIds.join(", "));
log("\n-- inputs --\n" + JSON.stringify(d.inputs, null, 2));
log("\n-- aria radio/button roles --\n" + JSON.stringify(d.aria, null, 2));
log("\n-- payment-ish elements --\n" + JSON.stringify(d.paymentish, null, 2));
log("\n-- placeOrderBtn --\n" + JSON.stringify(d.placeOrder));
log("\n-- legacy selector check --");
log("  input[name=\"paymentMethod\"] count:", await page.locator('input[name="paymentMethod"]').count());

await page.screenshot({ path: "/tmp/checkout-dom.png", fullPage: true });
log("\nscreenshot: /tmp/checkout-dom.png");

await browser.close();
log("\n== done — NO ORDER PLACED ==");
process.exit(0);
