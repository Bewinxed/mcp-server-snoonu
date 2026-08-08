// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Session MCP Tools
 * init_session, login, verify_otp, logout
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { loadSession, clearSession } from "../../lib/session-manager";
import { requestOtp, verifyOtp } from "../../lib/browser";
import { ensureAuthenticated } from "../lib/auth";
import { backendName } from "../lib/store";
import { ok, fail } from "../lib/result";

export function registerSessionTools(server: McpServer) {
	server.registerTool(
		"init_session",
		{
			title: "Session Status",
			description: `Check the current Snoonu session status. Loads previously saved authentication credentials from disk (~/.mcp-server-snoonu/session.json) and reports whether the user is already logged in.

This is an optional diagnostic — authentication resolves automatically when needed. Use it to inspect session details such as device ID, delivery location, persistence backend, and when the session was last saved.

Returns: logged_in status, device_id, whether a delivery location is set, store_backend, and when the session was last saved. If not logged in, the next step is to call login with the user's phone number.`,
			outputSchema: z.object({
				success: z.literal(true),
				logged_in: z.boolean(),
				device_id: z.string().nullable().optional(),
				has_location: z.boolean(),
				session_saved_at: z.string().nullable().optional(),
				store_backend: z.enum(["redis", "disk"]),
				message: z.string(),
			}),
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => {
			const session = await loadSession();
			const loggedIn = await ensureAuthenticated();

			return ok({
				success: true as const,
				logged_in: loggedIn,
				device_id: session?.deviceId || null,
				has_location: !!session?.location,
				session_saved_at: session?.savedAt || null,
				store_backend: backendName(),
				message: loggedIn
					? "Session loaded. User is logged in and ready to shop."
					: "No valid session found. Use `login` tool with a phone number to start login.",
			});
		},
	);

	server.registerTool(
		"login",
		{
			title: "Login",
			description: `Start the OTP login flow for Snoonu. Launches a headless Chromium browser, navigates to snoonu.com, enters the provided phone number, and requests a one-time password (OTP).

After calling this tool, you MUST ask the user for the 6-digit OTP code they received via SMS, then call verify_otp to complete login. Do not call any cart or checkout tools until login is complete.

This tool will fail if the user is already logged in — call logout first to switch accounts. Requires a working internet connection and Playwright/Chromium installed.`,
			inputSchema: z.object({
				phone_number: z
					.string()
					.describe(
						"Phone number without country code, e.g. '55123456' for a Qatar (+974) number",
					),
			}),
			outputSchema: z.object({
				success: z.literal(true),
				message: z.string(),
				next_step: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ phone_number }) => {
			if (await ensureAuthenticated()) {
				return fail(
					"Already logged in. Use logout first if you want to switch accounts.",
				);
			}

			const result = await requestOtp(phone_number);

			if (!result.success) {
				return fail(result.message);
			}

			return ok({
				success: true as const,
				message: result.message,
				next_step:
					"Ask the user for the 6-digit OTP code, then call verify_otp.",
			});
		},
	);

	server.registerTool(
		"verify_otp",
		{
			title: "Verify OTP",
			description: `Complete the Snoonu login by submitting the 6-digit OTP code the user received via SMS. Must be called after login — calling it without a prior login will fail.

On success, the session (cookies, auth token, device ID) is persisted to disk so future init_session calls restore it automatically. Returns whether login succeeded and the user's logged-in state.`,
			inputSchema: z.object({
				otp_code: z
					.string()
					.describe(
						"The 6-digit numeric OTP code the user received via SMS, e.g. '123456'",
					),
			}),
			outputSchema: z.object({
				success: z.literal(true),
				logged_in: z.boolean(),
				message: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ otp_code }) => {
			const result = await verifyOtp(otp_code);

			if (!result.success) {
				return fail(result.message, { logged_in: result.loggedIn });
			}

			return ok({
				success: true as const,
				logged_in: result.loggedIn,
				message: result.message,
			});
		},
	);

	server.registerTool(
		"logout",
		{
			title: "Logout",
			description: `Clear the current Snoonu session and log out. Deletes saved cookies, auth token, and device ID from disk. After calling this, the user must log in again with login + verify_otp to use cart or checkout tools.

Use this when the user wants to switch accounts or explicitly log out. Search and browse tools will continue to work without login, but cart and checkout will not.`,
			outputSchema: z.object({
				success: z.literal(true),
				message: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			await clearSession();
			return ok({
				success: true as const,
				message: "Session cleared. User is logged out.",
			});
		},
	);
}
