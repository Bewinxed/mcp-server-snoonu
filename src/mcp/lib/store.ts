// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Persistent store for product metadata and cart state.
 *
 * WHY THIS EXISTS
 * ---------------
 * Product metadata used to live in a module-level `Map`, which meant:
 *
 *   - `get_product_details` returned "not in cache" for a valid id in any fresh
 *     process (reproduced: search in process A, look up in process B → error).
 *   - `add_to_cart` silently sent `undefined` name/merchantId/price on a miss.
 *   - the cart evaporated on restart while `get_cart` reported "empty".
 *
 * MCP 2026-07-28 removes protocol sessions outright and requires list results
 * not to vary per-connection, so per-process memory is now actively wrong.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 * ------------------------------
 * Products are the public Snoonu catalogue — the same for everyone, and
 * expensive to rediscover — so they are cached ONCE, globally.
 *
 * Carts are personal. They live per user, so two people using the same HTTP
 * deployment never see each other's items. Getting this backwards would leak
 * one customer's shopping into another's checkout.
 *
 * BACKENDS
 * --------
 * Disk (default): JSON files under ~/.mcp-server-snoonu. Zero setup, which
 * matters because the primary distribution is `npx mcp-server-snoonu` over
 * stdio on a laptop — requiring a Redis daemon to search for milk is a bad
 * trade.
 *
 * Redis (opt-in): set REDIS_URL, for a multi-replica HTTP deployment that must
 * share state. Uses Bun's built-in `Bun.redis`, so no dependency — but the
 * published npm bin runs under Node, where `Bun` is absent, so the disk backend
 * is used there regardless.
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { currentUserId, userSlug } from "./user-context";

const DIR = join(homedir(), ".mcp-server-snoonu");
const PRODUCTS_FILE = join(DIR, "products.json");

const cartFile = (userId = currentUserId()): string =>
	join(DIR, "users", userSlug(userId), "cart.json");

/** Product metadata cached from search results, keyed by product id. */
export interface ProductRecord {
	productId: string;
	name: string;
	price: number;
	merchantId: number;
	merchantName: string;
	branchId?: string;
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

interface CartShape {
	cart: Record<string, CartRecord>;
	cartId: string | null;
}

/** Cap product entries so the shared catalogue cache cannot grow unbounded. */
const MAX_PRODUCTS = 5000;

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

const redisUrl = process.env.REDIS_URL;
const hasBunRedis =
	typeof (globalThis as any).Bun !== "undefined" &&
	typeof (globalThis as any).Bun?.redis !== "undefined";
const useRedis = Boolean(redisUrl) && hasBunRedis;
const PREFIX = process.env.REDIS_KEY_PREFIX || "mcp-server-snoonu";

if (redisUrl && !hasBunRedis) {
	console.error(
		"[store] REDIS_URL is set but Bun.redis is unavailable (running under Node?) — falling back to disk store.",
	);
}

async function redisGet(key: string): Promise<string | null> {
	return (globalThis as any).Bun.redis.get(key);
}
async function redisSet(key: string, value: string): Promise<void> {
	await (globalThis as any).Bun.redis.set(key, value);
}

/** Write-then-rename so a crash mid-write cannot truncate the file. */
async function atomicWrite(path: string, body: string): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(tmp, body, { mode: 0o600 });
	await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Debounced persistence
// ---------------------------------------------------------------------------

type Flusher = () => Promise<void>;
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; flush: Flusher }>();
let inFlight: Promise<unknown> = Promise.resolve();

/** Coalesce bursty writes (a search caches hundreds of products at once). */
function schedule(key: string, flush: Flusher): void {
	const existing = pending.get(key);
	if (existing) clearTimeout(existing.timer);
	const timer = setTimeout(() => {
		pending.delete(key);
		inFlight = flush().catch((err) =>
			console.error("[store] persist failed:", (err as Error).message),
		);
	}, 150);
	// Never hold the process open just to flush a cache.
	timer.unref?.();
	pending.set(key, { timer, flush });
}

/** Flush every pending write. Call before exit. */
export async function flush(): Promise<void> {
	const entries = [...pending.values()];
	pending.clear();
	for (const { timer } of entries) clearTimeout(timer);
	await Promise.all(entries.map(({ flush: f }) => f().catch(() => {})));
	await inFlight;
}

// ---------------------------------------------------------------------------
// Products — SHARED across users (public catalogue data)
// ---------------------------------------------------------------------------

let productCache: Record<string, ProductRecord> | null = null;

async function loadProducts(): Promise<Record<string, ProductRecord>> {
	if (productCache) return productCache;
	try {
		const raw = useRedis
			? await redisGet(`${PREFIX}:products`)
			: await readFile(PRODUCTS_FILE, "utf-8");
		productCache = raw ? (JSON.parse(raw) as Record<string, ProductRecord>) : {};
	} catch {
		// Missing, unreadable, or corrupt — start clean rather than crash on boot.
		productCache = {};
	}
	return productCache;
}

async function persistProducts(): Promise<void> {
	if (!productCache) return;
	const body = JSON.stringify(productCache);
	if (useRedis) await redisSet(`${PREFIX}:products`, body);
	else await atomicWrite(PRODUCTS_FILE, body);
}

export async function putProducts(records: ProductRecord[]): Promise<void> {
	if (records.length === 0) return;
	const products = await loadProducts();
	for (const r of records) products[r.productId] = r;

	const keys = Object.keys(products);
	if (keys.length > MAX_PRODUCTS) {
		// Drop oldest insertions (JS object key order is insertion order).
		for (const k of keys.slice(0, keys.length - MAX_PRODUCTS)) delete products[k];
	}
	schedule("products", persistProducts);
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
	return (await loadProducts())[id] ?? null;
}

// ---------------------------------------------------------------------------
// Cart — PER USER
// ---------------------------------------------------------------------------

const cartCache = new Map<string, CartShape>();

async function loadCart(userId = currentUserId()): Promise<CartShape> {
	const cached = cartCache.get(userId);
	if (cached) return cached;

	let shape: CartShape = { cart: {}, cartId: null };
	try {
		const raw = useRedis
			? await redisGet(`${PREFIX}:cart:${userSlug(userId)}`)
			: await readFile(cartFile(userId), "utf-8");
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<CartShape>;
			shape = { cart: parsed.cart ?? {}, cartId: parsed.cartId ?? null };
		}
	} catch {
		// no cart yet
	}
	cartCache.set(userId, shape);
	return shape;
}

function persistCartFor(userId: string): Flusher {
	return async () => {
		const shape = cartCache.get(userId);
		if (!shape) return;
		const body = JSON.stringify(shape);
		if (useRedis) await redisSet(`${PREFIX}:cart:${userSlug(userId)}`, body);
		else await atomicWrite(cartFile(userId), body);
	};
}

function scheduleCart(userId: string): void {
	schedule(`cart:${userId}`, persistCartFor(userId));
}

export async function getCartItems(): Promise<CartRecord[]> {
	const { cart } = await loadCart();
	return Object.values(cart).filter((i) => i.quantity > 0);
}

export async function setCartItems(items: CartRecord[]): Promise<void> {
	const userId = currentUserId();
	const shape = await loadCart(userId);
	shape.cart = {};
	for (const i of items) if (i.quantity > 0) shape.cart[i.productId] = i;
	scheduleCart(userId);
}

export async function clearCart(): Promise<void> {
	const userId = currentUserId();
	const shape = await loadCart(userId);
	shape.cart = {};
	shape.cartId = null;
	scheduleCart(userId);
}

export async function getCartId(): Promise<string | null> {
	return (await loadCart()).cartId;
}

export async function setCartId(id: string | null): Promise<void> {
	const userId = currentUserId();
	const shape = await loadCart(userId);
	shape.cartId = id;
	scheduleCart(userId);
}

/** Which backend is active — surfaced by init_session for debuggability. */
export function backendName(): "redis" | "disk" {
	return useRedis ? "redis" : "disk";
}
