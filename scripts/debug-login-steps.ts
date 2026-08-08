// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Step-by-step login diagnostic using the SAME browser stack as the library
 * (playwright-extra + stealth), to find where requestOtp diverges from a plain
 * Playwright run that works.
 *
 * Read-only: opens the login modal but never submits a phone number.
 */

import { connectBrowser, navigateToSnoonu } from "../src/lib/browser";

const p = await connectBrowser();
console.log("== connectBrowser ok ==");

await navigateToSnoonu();
console.log("after navigateToSnoonu:");
console.log("  url:", p.url());
console.log("  title:", await p.title().catch(() => "(none)"));
console.log("  readyState:", await p.evaluate(() => document.readyState));

const probe = async (label: string) => {
	const ids: string[] = await p.evaluate(() =>
		Array.from(document.querySelectorAll("[data-test-id]"))
			.map((e) => (e as HTMLElement).dataset.testId ?? "")
			.filter(Boolean),
	);
	const loginBtn = await p.locator('[data-test-id="loginBtn"]').count();
	const phone = await p.locator('[data-test-id="phoneInputField"]').count();
	const tel = await p.locator('input[type="tel"]').count();
	console.log(`\n[${label}]`);
	console.log("  url:", p.url());
	console.log(`  loginBtn=${loginBtn} phoneInputField=${phone} input[tel]=${tel}`);
	console.log("  test-ids:", [...new Set(ids)].sort().join(", ").slice(0, 300) || "(none)");
};

await probe("immediately after navigate");

console.log("\n== waiting 6s for hydration ==");
await p.waitForTimeout(6000);
await probe("after 6s settle");

// Click login the way requestOtp does
console.log("\n== clicking loginBtn ==");
try {
	await p.locator('[data-test-id="loginBtn"]').click({ timeout: 5000 });
	console.log("  clicked via data-test-id");
} catch (e) {
	console.log("  data-test-id click FAILED:", (e as Error).message.split("\n")[0]);
	try {
		await p.locator('button:has-text("Login")').first().click({ timeout: 5000 });
		console.log("  clicked via text fallback");
	} catch (e2) {
		console.log("  text fallback FAILED:", (e2 as Error).message.split("\n")[0]);
	}
}

await p.waitForTimeout(1500);
await probe("1.5s after login click");

await p.waitForTimeout(5000);
await probe("6.5s after login click");

await p.screenshot({ path: "/tmp/debug-login.png", fullPage: false });
console.log("\nscreenshot: /tmp/debug-login.png");
process.exit(0);
