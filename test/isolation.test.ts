// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-user isolation tests: verify that carts, sessions, and product lookups
 * behave correctly across independent user scopes backed by AsyncLocalStorage.
 */

import { test, expect, describe, afterAll } from "bun:test";
import { rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	runAsUser,
	currentUserId,
	userSlug,
	DEFAULT_USER,
} from "../src/mcp/lib/user-context";
import {
	putProducts,
	getProduct,
	getCartItems,
	setCartItems,
	flush,
} from "../src/mcp/lib/store";
import { saveSession, loadSession } from "../src/lib/session-manager";
import type { CartRecord, ProductRecord } from "../src/mcp/lib/store";
import type { SnoonuSession } from "../src/lib/session-manager";

const ALICE = `test_alice_${crypto.randomUUID()}`;
const BOB = `test_bob_${crypto.randomUUID()}`;

const BASE = join(homedir(), ".mcp-server-snoonu");
const PRODUCTS_FILE = join(BASE, "products.json");

let productsExistedBefore: boolean;
let originalProducts: string | null = null;

// Snapshot the products file so cleanup can restore the original state.
try {
	productsExistedBefore = existsSync(PRODUCTS_FILE);
	if (productsExistedBefore) {
		originalProducts = await readFile(PRODUCTS_FILE, "utf-8");
	}
} catch {
	productsExistedBefore = false;
}

afterAll(async () => {
	await flush();

	// Remove user directories created by these tests.
	for (const id of [ALICE, BOB]) {
		const dir = join(BASE, "users", userSlug(id));
		await rm(dir, { recursive: true, force: true });
	}

	// Restore or remove products.json.
	if (productsExistedBefore && originalProducts !== null) {
		await writeFile(PRODUCTS_FILE, originalProducts, { encoding: "utf-8" });
	} else {
		await rm(PRODUCTS_FILE, { force: true });
	}
});

// ---------------------------------------------------------------------------
// Cart isolation
// ---------------------------------------------------------------------------

describe("per-user cart isolation", () => {
	test("two users get independent carts", async () => {
		const aliceItem: CartRecord = {
			productId: "p1",
			name: "Milk",
			quantity: 2,
			price: 5,
			totalPrice: 10,
			merchantId: 1,
		};

		const bobItem: CartRecord = {
			productId: "p2",
			name: "Bread",
			quantity: 1,
			price: 3,
			totalPrice: 3,
			merchantId: 2,
		};

		await runAsUser(ALICE, () => setCartItems([aliceItem]));
		await runAsUser(BOB, () => setCartItems([bobItem]));

		const aliceCart = await runAsUser(ALICE, () => getCartItems());
		expect(aliceCart).toHaveLength(1);
		expect(aliceCart[0].productId).toBe("p1");
		expect(aliceCart[0].name).toBe("Milk");

		const bobCart = await runAsUser(BOB, () => getCartItems());
		expect(bobCart).toHaveLength(1);
		expect(bobCart[0].productId).toBe("p2");
		expect(bobCart[0].name).toBe("Bread");
	});
});

// ---------------------------------------------------------------------------
// Shared product catalogue
// ---------------------------------------------------------------------------

describe("shared product catalogue", () => {
	test("products written by one user are visible to another", async () => {
		const product: ProductRecord = {
			productId: "shared-1",
			name: "Shawarma",
			price: 15,
			merchantId: 99,
			merchantName: "Test Kitchen",
		};

		await runAsUser(ALICE, () => putProducts([product]));

		const found = await runAsUser(BOB, () => getProduct("shared-1"));
		expect(found).not.toBeNull();
		expect(found!.name).toBe("Shawarma");
		expect(found!.merchantName).toBe("Test Kitchen");
	});
});

// ---------------------------------------------------------------------------
// Session isolation
// ---------------------------------------------------------------------------

describe("per-user session isolation", () => {
	test("sessions are isolated between users", async () => {
		const aliceSession: SnoonuSession = {
			authToken: "alice-token",
			deviceId: "dev-alice",
			locationToken: "",
			location: { latitude: "25.3", longitude: "51.5", address: "Doha" },
			cookies: [],
			savedAt: new Date().toISOString(),
		};

		await runAsUser(ALICE, () => saveSession(aliceSession));

		const bobSession = await runAsUser(BOB, () => loadSession());
		expect(bobSession).toBeNull();

		const aliceLoaded = await runAsUser(ALICE, () => loadSession());
		expect(aliceLoaded).not.toBeNull();
		expect(aliceLoaded!.authToken).toBe("alice-token");
	});
});

// ---------------------------------------------------------------------------
// userSlug sanitisation
// ---------------------------------------------------------------------------

describe("userSlug sanitisation", () => {
	test("path traversal attempts are sanitised", () => {
		const slug = userSlug("../../etc/passwd");
		expect(slug).not.toContain("/");
		expect(slug).not.toContain("..");
		expect(slug).toBe("______etc_passwd");
	});

	test("empty string gives 'unknown'", () => {
		expect(userSlug("")).toBe("unknown");
	});

	test("long ids are truncated to 64 chars", () => {
		expect(userSlug("a".repeat(100)).length).toBeLessThanOrEqual(64);
	});
});

// ---------------------------------------------------------------------------
// Default user outside runAsUser
// ---------------------------------------------------------------------------

describe("currentUserId default", () => {
	test("returns DEFAULT_USER outside runAsUser", () => {
		expect(currentUserId()).toBe(DEFAULT_USER);
	});
});
