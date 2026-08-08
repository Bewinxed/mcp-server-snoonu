// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-user request context.
 *
 * WHY
 * ---
 * Everything under src/lib was written as module-level singletons: one
 * `cachedSession`, one `cartStore`, one Playwright browser. That is correct for
 * the stdio server (one process, one human) but wrong the moment the HTTP
 * server serves more than one person — every caller would share one Snoonu
 * account, one cart, and one checkout page.
 *
 * Threading a userId parameter through ~80 call sites would be a huge and
 * error-prone diff, and any missed call site silently leaks another user's
 * data. AsyncLocalStorage scopes it implicitly for the lifetime of a request
 * instead, so the singletons become per-user maps keyed off the ambient id and
 * a missed call site is a compile error rather than a data leak.
 *
 * The stdio server never calls runAsUser(), so it gets DEFAULT_USER and behaves
 * exactly as before.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_USER = "local";

interface UserContext {
	userId: string;
}

const als = new AsyncLocalStorage<UserContext>();

/** Run `fn` with every downstream lib call scoped to `userId`. */
export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
	return als.run({ userId }, fn);
}

/** The current user, or DEFAULT_USER for stdio / local single-user operation. */
export function currentUserId(): string {
	return als.getStore()?.userId ?? DEFAULT_USER;
}

/** True when running inside an explicit per-user scope (i.e. the HTTP server). */
export function isMultiUser(): boolean {
	return als.getStore() !== undefined;
}

/**
 * Keyed store of per-user state. Replaces a module-level singleton with one
 * instance per user, created on demand.
 */
export class PerUser<T> {
	private readonly values = new Map<string, T>();

	constructor(private readonly create: (userId: string) => T) {}

	get(userId = currentUserId()): T {
		let value = this.values.get(userId);
		if (value === undefined) {
			value = this.create(userId);
			this.values.set(userId, value);
		}
		return value;
	}

	set(value: T, userId = currentUserId()): void {
		this.values.set(userId, value);
	}

	delete(userId = currentUserId()): void {
		this.values.delete(userId);
	}

	has(userId = currentUserId()): boolean {
		return this.values.has(userId);
	}

	get size(): number {
		return this.values.size;
	}

	entries(): IterableIterator<[string, T]> {
		return this.values.entries();
	}
}

/**
 * A filesystem-safe slug for a user id, so per-user state can live in its own
 * file/key without path traversal or collisions.
 */
export function userSlug(userId = currentUserId()): string {
	return userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unknown";
}
