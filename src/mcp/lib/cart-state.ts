// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bridges api-client's in-memory cart with the persistent store.
 *
 * api-client keeps the cart in a module-level Map because multicart/sync is a
 * full-replacement endpoint that silently drops unrecognised items — reading
 * the cart back from the server would wipe it. That design is fine; what was
 * broken is that the Map died with the process, so a restart silently emptied
 * the user's cart while get_cart reported "empty" as though that were the truth.
 *
 * hydrate() is called at the top of every cart-touching tool, persist() after
 * every mutation.
 */

import { getCart, hydrateCart } from "../../lib/api-client";
import {
	getCartItems,
	setCartItems,
	getCartId,
	setCartId,
	type CartRecord,
} from "./store";
import { PerUser } from "./user-context";

/**
 * Hydration is tracked PER USER. A single boolean would mean the first user to
 * touch a cart marks it "done" for everyone, and every later user would run
 * against whatever was left in memory.
 */
const hydrated = new PerUser<boolean>(() => false);

/** Load the persisted cart into api-client's in-memory store. Idempotent. */
export async function hydrate(): Promise<void> {
	if (hydrated.get()) return;
	hydrated.set(true);

	const [items, id] = await Promise.all([getCartItems(), getCartId()]);
	if (items.length === 0 && !id) return;

	hydrateCart(
		items.map((i) => ({
			productId: i.productId,
			merchantId: i.merchantId,
			name: i.name,
			imageUrl: i.imageUrl ?? "",
			price: i.price,
			quantity: i.quantity,
			totalPrice: i.totalPrice,
			isAvailable: true,
		})),
		id,
	);
}

/** Write api-client's current cart back to the persistent store. */
export async function persist(): Promise<void> {
	const cart = getCart();
	const records: CartRecord[] = cart.items.map((i) => ({
		productId: i.productId,
		name: i.name,
		quantity: i.quantity,
		price: i.price,
		totalPrice: i.totalPrice,
		merchantId: i.merchantId,
		imageUrl: i.imageUrl || undefined,
	}));
	await Promise.all([setCartItems(records), setCartId(cart.cartId ?? null)]);
}
