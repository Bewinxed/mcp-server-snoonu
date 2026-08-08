// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lazy session guard.
 *
 * BUG THIS FIXES
 * --------------
 * `isAuthenticated()` reads a module-level `cachedSession` that only
 * `loadSession()` populates, and at the tool layer only `init_session` ever
 * called `loadSession()`. Every auth-gated tool therefore short-circuited to
 * "Must be logged in" — before api-client's own lazy load could run — whenever
 * the model hadn't first called `init_session`. A valid session sitting on disk
 * was invisible.
 *
 * `init_session` cannot be a precondition under MCP 2026-07-28 anyway: there is
 * no session handshake to hang it off, and nothing compels a client to call one
 * tool before another. So authentication resolves itself on demand instead.
 */

import { loadSession, isAuthenticated } from "../../lib/session-manager";

/**
 * Ensure the on-disk session is loaded, then report auth state.
 * `loadSession()` is idempotent and memoised, so this is cheap to call on
 * every tool invocation.
 */
export async function ensureAuthenticated(): Promise<boolean> {
	await loadSession();
	return isAuthenticated();
}
