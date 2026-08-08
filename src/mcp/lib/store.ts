// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Persistent key/value store for product metadata and cart state.
 *
 * WHY THIS EXISTS
 * ---------------
 * Snoonu exposes no "fetch product by id" endpoint — every lookup is
 * search-shaped. So once a product id leaves this server (into a model's
 * context), the only way to resolve it back to a name/price/merchantId is to
 * have remembered it. That memory used to be a module-level `Map`, which meant:
 *
 *   - `get_product_details` returned "not in cache" for a valid id in any fresh
 *     process (reproduced: search in process A, look up in process B → error).
 *   - `add_to_cart` silently sent `undefined` name/merchantId/price on a miss.
 *   - the cart evaporated on restart while `get_cart` reported "empty".
 *
 * MCP 2026-07-28 removes protocol sessions outright and requires list results
 * not to vary per-connection, so per-process memory is now actively wrong.
 *
 * BACKENDS
 * --------
 * Disk (default): a JSON file next to the existing session.json. Zero setup,
 * which matters because the primary distribution is `npx mcp-server-snoonu`
 * over stdio on a laptop — requiring a Redis daemon to search for milk is a
 * bad trade.
 *
 * Redis (opt-in): set REDIS_URL. Intended for the Docker/hosted HTTP
 * deployment where multiple stateless workers must share state. Uses Bun's
 * built-in `Bun.redis`, so it adds no dependency — but note the published npm
 * bin runs under Node, where `Bun` is absent; there the disk backend is used
 * regardless. The Dockerfile runs under Bun, so Redis works there.
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".mcp-server-snoonu");
const FILE = join(DIR, "store.json");

/** Product metadata cached from search results, keyed by product id. */
export interface ProductRecord {
	productId: string;
	name: string;
	price: number;
	merchantId: number;
	merchantName: string;
	menuId?: number;
	imageUrl?: string;
	description?: string;
	isInStock?: boolean;
	isAvailable?: boolean;
	stockCount?: number;
	originalPrice?: number;
	discountPercentage?: number;
}

export interface CartRecord {
	productId: string;
	name: string;
	quantity: number;
	price: number;
	totalPrice: number;
	merchantId: number;
	imageUrl?: string;
}

interface Shape {
	products: Record<string, ProductRecord>;
	cart: Record<string, CartRecord>;
	cartId: string | null;
}

/** Cap product entries so the file cannot grow without bound. */
const MAX_PRODUCTS = 5000;

const empty = (): Shape => ({ products: {}, cart: {}, cartId: null });

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

const redisUrl = process.env.REDIS_URL;
const hasBunRedis =
	typeof (globalThis as any).Bun !== "undefined" &&
	typeof (globalThis as any).Bun?.redis !== "undefined";
const useRedis = Boolean(redisUrl) && hasBunRedis;
const REDIS_KEY = process.env.REDIS_KEY_PREFIX
	? `${process.env.REDIS_KEY_PREFIX}:store`
	: "mcp-server-snoonu:store";

if (redisUrl && !hasBunRedis) {
	console.error(
		"[store] REDIS_URL is set but Bun.redis is unavailable (running under Node?) — falling back to disk store.",
	);
}

// ---------------------------------------------------------------------------
// Load / persist
// ---------------------------------------------------------------------------

let cache: Shape | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

async function readBackend(): Promise<Shape> {
	try {
		const raw = useRedis
			? await (globalThis as any).Bun.redis.get(REDIS_KEY)
			: await readFile(FILE, "utf-8");
		if (!raw) return empty();
		const parsed = JSON.parse(raw) as Partial<Shape>;
		return {
			products: parsed.products ?? {},
			cart: parsed.cart ?? {},
			cartId: parsed.cartId ?? null,
		};
	} catch {
		// Missing file, unreadable file, or corrupt JSON — start clean rather
		// than crashing the server on a cold start.
		return empty();
	}
}

async function load(): Promise<Shape> {
	if (!cache) cache = await readBackend();
	return cache;
}

async function persist(): Promise<void> {
	if (!cache) return;
	const body = JSON.stringify(cache);
	try {
		if (useRedis) {
			await (globalThis as any).Bun.redis.set(REDIS_KEY, body);
		} else {
			await mkdir(DIR, { recursive: true, mode: 0o700 });
			// Write-then-rename so a crash mid-write cannot truncate the store.
			const tmp = `${FILE}.${process.pid}.tmp`;
			await writeFile(tmp, body, { mode: 0o600 });
			await rename(tmp, FILE);
		}
	} catch (err) {
		console.error("[store] failed to persist:", (err as Error).message);
	}
}

/** Coalesce bursty writes (a search caches hundreds of products at once). */
function schedulePersist(): void {
	if (writeTimer) clearTimeout(writeTimer);
	writeTimer = setTimeout(() => {
		writeTimer = null;
		writing = persist();
	}, 150);
	// Never hold the process open just to flush the cache.
	writeTimer.unref?.();
}

/** Flush any pending write. Call before exit. */
export async function flush(): Promise<void> {
	if (writeTimer) {
		clearTimeout(writeTimer);
		writeTimer = null;
		writing = persist();
	}
	await writing;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function putProducts(records: ProductRecord[]): Promise<void> {
	if (records.length === 0) return;
	const s = await load();
	for (const r of records) s.products[r.productId] = r;

	const keys = Object.keys(s.products);
	if (keys.length > MAX_PRODUCTS) {
		// Drop oldest insertions (JS object key order is insertion order).
		for (const k of keys.slice(0, keys.length - MAX_PRODUCTS)) {
			delete s.products[k];
		}
	}
	schedulePersist();
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
	const s = await load();
	return s.products[id] ?? null;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export async function getCartItems(): Promise<CartRecord[]> {
	const s = await load();
	return Object.values(s.cart).filter((i) => i.quantity > 0);
}

export async function setCartItems(items: CartRecord[]): Promise<void> {
	const s = await load();
	s.cart = {};
	for (const i of items) if (i.quantity > 0) s.cart[i.productId] = i;
	schedulePersist();
}

export async function clearCart(): Promise<void> {
	const s = await load();
	s.cart = {};
	s.cartId = null;
	schedulePersist();
}

export async function getCartId(): Promise<string | null> {
	return (await load()).cartId;
}

export async function setCartId(id: string | null): Promise<void> {
	const s = await load();
	s.cartId = id;
	schedulePersist();
}

/** Which backend is active — surfaced by init_session for debuggability. */
export function backendName(): "redis" | "disk" {
	return useRedis ? "redis" : "disk";
}
