// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Selector audit — diagnostic only, no auth required, no clicks that mutate state.
 *
 * Loads snoonu.com in Chromium and checks every selector src/lib/browser.ts
 * depends on, reporting which still resolve against the live DOM.
 *
 *   bun run scripts/audit-selectors.ts
 */

import { chromium } from "playwright";

const SITE = "https://snoonu.com";

type Check = { where: string; selector: string; note?: string };

const PUBLIC_CHECKS: Check[] = [
	{ where: "requestOtp", selector: '[data-test-id="loginBtn"]' },
	{ where: "requestOtp (fallback)", selector: 'button:has-text("Login")' },
	{ where: "dismissLocationModal", selector: 'button:has-text("Confirm location")' },
	{
		where: "dismissLocationModal",
		selector: '[class*="Modal_cross"], [aria-label="Close"]',
	},
];

const LOGIN_MODAL_CHECKS: Check[] = [
	{ where: "requestOtp", selector: 'input[type="tel"]', note: "phone input" },
	{ where: "requestOtp", selector: '[data-test-id="btnContinueLogin"]' },
	{ where: "requestOtp (fallback)", selector: 'button:has-text("Continue")' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	locale: "en-US",
});
const page = await context.newPage();

const xhr: Array<{ method: string; url: string }> = [];
page.on("request", (r) => {
	const t = r.resourceType();
	if (t === "xhr" || t === "fetch") xhr.push({ method: r.method(), url: r.url() });
});

console.log(`== loading ${SITE} ==`);
await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(5000);
console.log("landed on:", page.url());
console.log("title:", await page.title());

async function check(c: Check): Promise<boolean> {
	const n = await page.locator(c.selector).count().catch(() => 0);
	const visible =
		n > 0 ? await page.locator(c.selector).first().isVisible().catch(() => false) : false;
	const status = n === 0 ? "MISSING" : visible ? "ok" : `present-but-hidden`;
	console.log(
		`  ${status.padEnd(20)} ${c.selector}${c.note ? `  (${c.note})` : ""}   [${c.where}]`,
	);
	return n > 0;
}

console.log("\n== public selectors ==");
for (const c of PUBLIC_CHECKS) await check(c);

// What test ids does the page actually expose? Ground truth for drift.
const testIds: string[] = await page.evaluate(() =>
	Array.from(document.querySelectorAll("[data-test-id]"))
		.map((e) => (e as HTMLElement).dataset.testId ?? "")
		.filter(Boolean),
);
console.log(`\n== data-test-id values present on the landing page (${testIds.length}) ==`);
console.log(" ", [...new Set(testIds)].sort().join(", ") || "(none)");

// Try to open the login modal so its selectors can be checked too.
console.log("\n== attempting to open login modal ==");
let opened = false;
for (const sel of [
	'[data-test-id="loginBtn"]',
	'button:has-text("Login")',
	'button:has-text("Sign in")',
	'[href*="login"]',
]) {
	try {
		const loc = page.locator(sel).first();
		if ((await loc.count()) > 0 && (await loc.isVisible())) {
			await loc.click({ timeout: 5000 });
			await page.waitForTimeout(3000);
			opened = true;
			console.log(`  opened via: ${sel}`);
			break;
		}
	} catch {
		/* try next */
	}
}
if (!opened) console.log("  could not open a login modal with any known selector");

console.log("\n== login-modal selectors ==");
for (const c of LOGIN_MODAL_CHECKS) await check(c);

const modalTestIds: string[] = await page.evaluate(() =>
	Array.from(document.querySelectorAll("[data-test-id]"))
		.map((e) => (e as HTMLElement).dataset.testId ?? "")
		.filter(Boolean),
);
const newIds = [...new Set(modalTestIds)].filter((i) => !testIds.includes(i));
console.log(`\n== new data-test-id values after opening login (${newIds.length}) ==`);
console.log(" ", newIds.sort().join(", ") || "(none)");

// Ground truth for the API question.
console.log("\n== XHR/fetch endpoints the live site called ==");
const seen = new Set<string>();
for (const r of xhr) {
	const u = new URL(r.url);
	const key = `${r.method} ${u.host}${u.pathname}`;
	if (!seen.has(key)) {
		seen.add(key);
		console.log(`  ${key}`);
	}
}

await page.screenshot({ path: "/tmp/snoonu-landing.png", fullPage: false });
console.log("\nscreenshot: /tmp/snoonu-landing.png");

await browser.close();
