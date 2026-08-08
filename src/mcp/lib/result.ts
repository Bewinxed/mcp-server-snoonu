// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared tool-result helpers.
 *
 * Under MCP 2026-07-28 a tool that fails MUST set `isError: true` so the client
 * and model can tell success from failure. Previously every tool in this server
 * returned `isError: false` with `{"error": true}` buried in the text body,
 * which is invisible to the protocol.
 *
 * `ok()` also emits `structuredContent`, which lets clients consume typed data
 * instead of re-parsing JSON out of a text block.
 */

export type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	structuredContent?: unknown;
	isError?: boolean;
};

/** A successful tool result: JSON text plus machine-readable structured output. */
export function ok<T>(data: T): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(data) }],
		structuredContent: data as unknown,
	};
}

/**
 * A failed tool result. Sets `isError: true` (protocol-visible) and keeps the
 * actionable `message` the model needs to recover.
 */
export function fail(
	message: string,
	extra: Record<string, unknown> = {},
): ToolResult {
	const payload = { error: true, message, ...extra };
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
}

/** Standard "you must log in first" failure, worded so the model self-corrects. */
export function authRequired(action: string): ToolResult {
	return fail(
		`Must be logged in to ${action}. Call login with the user's phone number, then verify_otp with the code they receive.`,
		{ logged_in: false, next_step: "login" },
	);
}
