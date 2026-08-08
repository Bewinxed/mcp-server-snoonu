// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Why doesn't the OTP screen appear? Reads the page + the OTP network calls
 * instead of guessing. Read-only.
 *
 *   bun run scripts/diagnose-otp-block.ts <phone>
 */

import { chromium } from "playwright";

const PHONE = process.argv[2];
if (!PHONE) throw new Error("usage: diagnose-otp-block.ts <phone>");

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

// Capture the OTP endpoints specifically, with bodies.
const calls: Array<{ url: string; status: number; body: string }> = [];
page.on("response", async (r) => {
	const u = r.url();
	if (/otp|login|auth|verify/i.test(u) && u.includes("snoonu.com")) {
		let body = "";
		try {
			body = (await r.text()).slice(0, 600);
		} catch {
			body = "(unreadable)";
		}
		calls.push({ url: u, status: r.status(), body });
	}
});

await page.goto("https://snoonu.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator('[data-test-id="loginBtn"]').waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(4000);

for (const sel of ['[data-test-id="confirmLocationBtn"]', '[data-test-id="crossIconBtn"]']) {
	const el = page.locator(sel).first();
	if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
		await el.click({ force: true }).catch(() => {});
		await page.waitForTimeout(1000);
	}
}

await page.locator('[data-test-id="loginBtn"]').click({ timeout: 10_000 });
await page.waitForTimeout(3000);

const phone = page.locator('[data-test-id="phoneInputField"]').first();
await phone.waitFor({ state: "visible", timeout: 20_000 });
await page
	.locator('[class*="MapLoading"][class*="loading"]')
	.first()
	.waitFor({ state: "detached", timeout: 12_000 })
	.catch(() => {});
await phone.focus();
await phone.fill("");
await phone.pressSequentially(PHONE, { delay: 90 });
console.log("phone filled:", JSON.stringify(await phone.inputValue()));
await page.waitForTimeout(1500);

const btn = page.locator('[data-test-id="btnContinueLogin"]').first();
console.log("continue button:");
console.log("  visible:", await btn.isVisible().catch(() => false));
console.log("  enabled:", await btn.isEnabled().catch(() => false));
console.log("  text:", (await btn.textContent().catch(() => ""))?.trim());

// Plain click with a generous timeout — this is what worked in the run that
// successfully logged in. Report exactly which path was taken.
let clickPath = "plain";
try {
	await btn.click({ timeout: 25_000 });
} catch (e) {
	clickPath = "forced";
	console.log("  plain click failed:", (e as Error).message.split("\n")[0]);
	await btn.click({ force: true, timeout: 5000 }).catch(async () => {
		clickPath = "js";
		await btn.evaluate((el) => (el as HTMLElement).click());
	});
}
console.log("  click path:", clickPath);

await page.waitForTimeout(9000);

console.log("\n== after continue ==");
console.log("pinInputField count:", await page.locator('[data-test-id="pinInputField"]').count());
console.log("phoneInputField still present:", await page.locator('[data-test-id="phoneInputField"]').count());

// What does the modal actually say now?
const text = await page.evaluate(() => {
	const modal =
		document.querySelector('[class*="Modal"]') ||
		document.querySelector('[role="dialog"]') ||
		document.body;
	return (modal as HTMLElement).innerText.slice(0, 1200);
});
console.log("\n== visible modal text ==\n" + text);

const errors = await page.evaluate(() =>
	Array.from(document.querySelectorAll('[class*="error" i],[class*="Error"],[role="alert"]'))
		.map((e) => (e as HTMLElement).innerText.trim())
		.filter(Boolean)
		.slice(0, 10),
);
console.log("\n== error elements ==\n", errors.length ? errors : "(none)");

console.log("\n== OTP / auth network calls ==");
for (const c of calls) {
	console.log(`  ${c.status}  ${new URL(c.url).pathname}`);
	console.log(`     ${c.body.replace(/\s+/g, " ").slice(0, 400)}`);
}
if (!calls.length) console.log("  (no otp/auth request was made at all)");

await page.screenshot({ path: "/tmp/otp-block.png", fullPage: false });
console.log("\nscreenshot: /tmp/otp-block.png");
await browser.close();
