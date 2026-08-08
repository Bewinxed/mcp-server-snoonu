// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live login + checkout selector probe — DIAGNOSTIC ONLY.
 *
 * SAFETY CONTRACT:
 *   - Never clicks the place-order button.
 *   - Never completes a purchase.
 *   - Only reads the DOM and reports which selectors resolve.
 *
 *   bun run scripts/live-login-probe.ts <phone>
 *   echo 123456 > /tmp/otp.txt      # when the SMS arrives
 */

import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";

const PHONE = process.argv[2];
if (!PHONE) throw new Error("usage: live-login-probe.ts <phone>");
const OTP_FILE = "/tmp/otp.txt";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	locale: "en-US",
});
const page = await context.newPage();

const api: Array<{ method: string; url: string; status: number }> = [];
page.on("response", async (r) => {
	const u = r.url();
	if (u.includes("snoonu.com/api")) {
		api.push({ method: r.request().method(), url: u, status: r.status() });
	}
});

const testIds = async (): Promise<string[]> =>
	page.evaluate(() =>
		Array.from(document.querySelectorAll("[data-test-id]"))
			.map((e) => (e as HTMLElement).dataset.testId ?? "")
			.filter(Boolean),
	);

async function dismissLocation(): Promise<string> {
	for (const sel of [
		'[data-test-id="confirmLocationBtn"]',
		'[data-test-id="crossIconBtn"]',
		'[data-test-id="crossXBtn"]',
	]) {
		const el = page.locator(sel).first();
		if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
			await el.click({ timeout: 3000 }).catch(() => {});
			await page.waitForTimeout(800);
			return sel;
		}
	}
	return "(none visible)";
}

console.log("== load snoonu.com ==");
await page.goto("https://snoonu.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(4000);
console.log("location modal dismissed via:", await dismissLocation());

console.log("\n== open login ==");
await page.locator('[data-test-id="loginBtn"]').click({ timeout: 10_000 });
await page.waitForTimeout(2500);
await dismissLocation();

const phoneField = page.locator('[data-test-id="phoneInputField"], input[type="tel"]').first();
await phoneField.waitFor({ state: "visible", timeout: 15_000 });
await phoneField.click();
await phoneField.fill(PHONE);
console.log("phone entered");

const beforeIds = await testIds();
await page.locator('[data-test-id="btnContinueLogin"]').click({ timeout: 10_000 });
console.log("clicked continue — SMS should be sending");
await page.waitForTimeout(4000);

const afterIds = await testIds();
const otpScreenIds = afterIds.filter((i) => !beforeIds.includes(i));

console.log("\n== OTP SCREEN DOM (ground truth for requestOtp/verifyOtp) ==");
console.log("  new data-test-id values:", otpScreenIds.join(", ") || "(none)");
const inputs = await page.evaluate(() =>
	Array.from(document.querySelectorAll("input")).map((i) => ({
		type: i.type,
		testId: (i as HTMLElement).dataset.testId ?? null,
		name: i.name || null,
		maxLength: i.maxLength,
		inputMode: i.inputMode || null,
		autocomplete: i.autocomplete || null,
		visible: !!(i.offsetWidth || i.offsetHeight),
	})),
);
console.log("  inputs on OTP screen:", JSON.stringify(inputs, null, 2));
console.log(
	"  NOTE: old code waited for input[type=tel] to be visible, which the PHONE " +
		"field already satisfies — so it reported 'OTP sent' regardless of outcome.",
);

/** Wait for a fresh code in OTP_FILE, ignoring any code already tried. */
async function waitForCode(tried: Set<string>, ms: number): Promise<string | null> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (existsSync(OTP_FILE)) {
			const raw = (await readFile(OTP_FILE, "utf-8")).trim();
			if (/^\d{4,8}$/.test(raw) && !tried.has(raw)) return raw;
		}
		await new Promise((r) => setTimeout(r, 1500));
	}
	return null;
}

async function isLoggedIn(): Promise<boolean> {
	return page.evaluate(() => document.cookie.includes("authToken"));
}

async function fillOtp(code: string): Promise<void> {
	const otpInputs = page.locator(
		'[data-test-id="pinInputField"], input[type="tel"], input[inputmode="numeric"]',
	);
	const n = await otpInputs.count();
	if (n > 1) {
		for (let i = 0; i < code.length && i < n; i++) {
			await otpInputs.nth(i).fill(code[i]!);
			await page.waitForTimeout(120);
		}
	} else {
		await otpInputs.first().fill("");
		await otpInputs.first().type(code, { delay: 120 });
	}
	await page.waitForTimeout(7000);
}

// An OTP supplied on argv is tried first — useful when a code was already sent.
const preset = process.argv[3];
const tried = new Set<string>();
let loggedIn = false;

if (preset && /^\d{4,8}$/.test(preset)) {
	console.log(`\n== trying preset OTP (${preset.length} digits) ==`);
	tried.add(preset);
	await fillOtp(preset);
	loggedIn = await isLoggedIn();
	console.log("  logged in:", loggedIn);
}

console.log(`\n== waiting for OTP in ${OTP_FILE} (20 min, retries allowed) ==`);
while (!loggedIn) {
	const code = await waitForCode(tried, 1_200_000);
	if (!code) {
		console.log("!! no further OTP supplied — stopping before login");
		await page.screenshot({ path: "/tmp/snoonu-otp-screen.png" });
		console.log("screenshot: /tmp/snoonu-otp-screen.png");
		await browser.close();
		process.exit(0);
	}
	console.log(`== filling OTP (${code.length} digits) ==`);
	tried.add(code);
	await fillOtp(code);
	loggedIn = await isLoggedIn();
	console.log("  logged in:", loggedIn);
	if (!loggedIn) {
		const err = await page
			.locator('[class*="error"], [class*="Error"]')
			.first()
			.textContent()
			.catch(() => null);
		console.log("  page error text:", err?.trim() || "(none found)");
		console.log("  -> send another code by writing a new value to /tmp/otp.txt");
	}
}
console.log("authToken cookie present:", loggedIn);
console.log("current url:", page.url());

// ---------------------------------------------------------------------------
// Checkout selector inspection — READ ONLY
// ---------------------------------------------------------------------------
console.log("\n== navigating to checkout (NO ORDER WILL BE PLACED) ==");
await page.goto("https://snoonu.com/checkout", {
	waitUntil: "domcontentloaded",
	timeout: 60_000,
});
await page.waitForTimeout(6000);
console.log("checkout url:", page.url());

const checkoutIds = await testIds();
console.log("\n== data-test-id values on checkout ==");
console.log(" ", [...new Set(checkoutIds)].sort().join(", ") || "(none)");

for (const sel of [
	'[data-test-id="placeOrderBtn"]',
	'input[name="paymentMethod"]',
]) {
	const count = await page.locator(sel).count().catch(() => 0);
	const visible =
		count > 0 ? await page.locator(sel).first().isVisible().catch(() => false) : false;
	console.log(
		`  ${count === 0 ? "MISSING" : visible ? "ok" : "present-but-hidden"}  ${sel}  (count=${count})`,
	);
}

const buttons = await page.evaluate(() =>
	Array.from(document.querySelectorAll("button"))
		.filter((b) => !!(b.offsetWidth || b.offsetHeight))
		.map((b) => ({
			text: (b.textContent || "").trim().slice(0, 40),
			testId: (b as HTMLElement).dataset.testId ?? null,
			disabled: b.disabled,
		}))
		.slice(0, 25),
);
console.log("\n== visible buttons on checkout ==");
console.log(JSON.stringify(buttons, null, 2));

await page.screenshot({ path: "/tmp/snoonu-checkout.png", fullPage: false });
console.log("\nscreenshot: /tmp/snoonu-checkout.png");

console.log("\n== snoonu API calls observed ==");
const seen = new Set<string>();
for (const r of api) {
	const u = new URL(r.url);
	const k = `${r.method} ${u.host}${u.pathname} -> ${r.status}`;
	if (!seen.has(k)) {
		seen.add(k);
		console.log("  " + k);
	}
}

await browser.close();
console.log("\n== done (no order placed) ==");
