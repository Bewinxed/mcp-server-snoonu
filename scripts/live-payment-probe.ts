// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live payment-selector probe — DIAGNOSTIC ONLY.
 *
 * Exercises the REAL library code paths (requestOtp -> verifyOtp -> addToCart ->
 * goToCheckout) and then dumps the checkout payment DOM so the correct
 * selectors can be identified.
 *
 * SAFETY CONTRACT: never clicks the place-order button, never completes a purchase.
 *
 *   bun run scripts/live-payment-probe.ts <phone>
 *   echo 123456 > /tmp/otp.txt
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
	requestOtp,
	verifyOtp,
	connectBrowser,
	goToCheckout,
	getPaymentMethods,
} from "../src/lib/browser";
import { searchProducts, addToCart } from "../src/lib/api-client";
import { loadSession, isAuthenticated } from "../src/lib/session-manager";

const PHONE = process.argv[2];
if (!PHONE) throw new Error("usage: live-payment-probe.ts <phone>");
const OTP_FILE = "/tmp/otp.txt";

const log = (...a: unknown[]) => console.log(...a);

await loadSession();
log("already authenticated:", isAuthenticated());

if (!isAuthenticated()) {
	log("\n== requesting OTP (tests the fixed pinInputField wait) ==");
	const req = await requestOtp(PHONE);
	log("  ", JSON.stringify(req));
	if (!req.success) {
		log("!! requestOtp failed — aborting");
		process.exit(1);
	}

	log(`\n== waiting for a NEW OTP in ${OTP_FILE} (20 min) ==`);
	const tried = new Set<string>();
	const deadline = Date.now() + 1_200_000;
	let ok = false;
	while (!ok && Date.now() < deadline) {
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
		log(`== verifying OTP (${code.length} digits) ==`);
		const v = await verifyOtp(code);
		log("  ", JSON.stringify({ success: v.success, loggedIn: v.loggedIn, message: v.message }));
		ok = v.loggedIn;
		if (!ok) log("  -> not logged in; write another code to /tmp/otp.txt");
	}
	if (!ok) {
		log("!! login did not complete — aborting");
		process.exit(1);
	}
}

await loadSession();
log("\nauthenticated:", isAuthenticated());

// --- Build a real cart so the payment section actually renders ---------------
log("\n== searching for an item ==");
const result = await searchProducts("milk", { category: "Groceries", productSize: 5 });
const merchant = result.merchants.find((m) => m.isOpen && m.products.length > 0);
const product = merchant?.products[0];
if (!product) {
	log("!! no open merchant/product found — cannot build a cart");
	process.exit(1);
}
log(`  ${product.name} @ ${product.price} from ${merchant!.name}`);

log("\n== adding to cart ==");
const cart = await addToCart([
	{
		productId: product.productId,
		quantity: 1,
		name: product.name,
		merchantId: product.merchantId,
		imageUrl: product.imageUrl,
		price: product.price,
		isAvailable: product.isAvailable,
	},
]);
log(`  cart: ${cart.totalQuantity} item(s), total ${cart.totalPrice}`);

log("\n== go to checkout ==");
const co = await goToCheckout();
log("  ", JSON.stringify(co).slice(0, 300));

const p = await connectBrowser();
await p.waitForTimeout(6000);
log("  url:", p.url());

// --- What the CURRENT code finds -------------------------------------------
log("\n== getPaymentMethods() as currently implemented ==");
const pm = await getPaymentMethods();
log("  ", JSON.stringify(pm).slice(0, 400));

// --- Ground truth ----------------------------------------------------------
log("\n== checkout DOM: what actually exists ==");
const dom = await p.evaluate(() => {
	const testIds = Array.from(document.querySelectorAll("[data-test-id]"))
		.map((e) => (e as HTMLElement).dataset.testId ?? "")
		.filter(Boolean);

	const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
		type: i.type,
		name: i.name || null,
		testId: (i as HTMLElement).dataset.testId ?? null,
		value: i.value?.slice(0, 30) || null,
		checked: i.checked,
		visible: !!(i.offsetWidth || i.offsetHeight),
	}));

	const radios = Array.from(
		document.querySelectorAll('[role="radio"], [role="radiogroup"]'),
	).map((e) => ({
		role: e.getAttribute("role"),
		testId: (e as HTMLElement).dataset.testId ?? null,
		ariaChecked: e.getAttribute("aria-checked"),
		text: (e.textContent || "").trim().slice(0, 60),
	}));

	// Anything that looks payment-related, by text or attribute
	const paymentish = Array.from(document.querySelectorAll("*"))
		.filter((e) => {
			const el = e as HTMLElement;
			if (!(el.offsetWidth || el.offsetHeight)) return false;
			const attrs = Array.from(e.attributes)
				.map((a) => `${a.name}=${a.value}`)
				.join(" ");
			return /pay|card|cash|wallet/i.test(attrs);
		})
		.slice(0, 30)
		.map((e) => ({
			tag: e.tagName.toLowerCase(),
			testId: (e as HTMLElement).dataset.testId ?? null,
			cls: (e.className || "").toString().slice(0, 60),
			text: (e.textContent || "").trim().slice(0, 50),
		}));

	const placeBtn = document.querySelector<HTMLButtonElement>(
		'[data-test-id="placeOrderBtn"]',
	);

	return {
		testIds: [...new Set(testIds)].sort(),
		inputs,
		radios,
		paymentish,
		placeOrder: placeBtn
			? { found: true, disabled: placeBtn.disabled, text: placeBtn.textContent?.trim() }
			: { found: false },
	};
});

log("\n-- data-test-id values --");
log(" ", dom.testIds.join(", "));
log("\n-- inputs --");
log(JSON.stringify(dom.inputs, null, 2));
log("\n-- ARIA radios --");
log(JSON.stringify(dom.radios, null, 2));
log("\n-- payment-ish elements --");
log(JSON.stringify(dom.paymentish, null, 2));
log("\n-- placeOrderBtn --");
log(JSON.stringify(dom.placeOrder));

await p.screenshot({ path: "/tmp/snoonu-checkout-cart.png", fullPage: true });
log("\nscreenshot: /tmp/snoonu-checkout-cart.png");
log("\n== done — NO ORDER PLACED ==");
process.exit(0);
