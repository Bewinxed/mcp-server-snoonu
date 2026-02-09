/**
 * Session MCP Tools
 * init_session, login, verify_otp, logout
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	loadSession,
	clearSession,
	isAuthenticated,
} from "../../lib/session-manager";
import {
	requestOtp,
	verifyOtp,
} from "../../lib/browser";

export function registerSessionTools(server: McpServer) {
	server.tool(
		"init_session",
		`Initialize or restore a Snoonu shopping session. Loads previously saved authentication credentials from disk (~/.mcp-server-snoonu/session.json) and checks whether the user is already logged in.

Call this FIRST before any other tool — it hydrates cookies, device ID, and delivery location so that search, cart, and checkout tools work correctly.

Returns: logged_in status, device_id, whether a delivery location is set, and when the session was last saved. If not logged in, the next step is to call login with the user's phone number.`,
		{},
		async () => {
			const session = await loadSession();
			const loggedIn = isAuthenticated();

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
							logged_in: loggedIn,
							device_id: session?.deviceId || null,
							has_location: !!session?.location,
							session_saved_at: session?.savedAt || null,
							message: loggedIn
								? "Session loaded. User is logged in and ready to shop."
								: "No valid session found. Use `login` tool with a phone number to start login.",
						}),
					},
				],
			};
		}
	);

	server.tool(
		"login",
		`Start the OTP login flow for Snoonu. Launches a headless Chromium browser, navigates to snoonu.com, enters the provided phone number, and requests a one-time password (OTP).

After calling this tool, you MUST ask the user for the 6-digit OTP code they received via SMS, then call verify_otp to complete login. Do not call any cart or checkout tools until login is complete.

This tool will fail if the user is already logged in — call logout first to switch accounts. Requires a working internet connection and Playwright/Chromium installed.`,
		{
			phone_number: z
				.string()
				.describe(
					"Phone number without country code, e.g. '55123456' for a Qatar (+974) number"
				),
		},
		async ({ phone_number }) => {
			if (isAuthenticated()) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								message:
									"Already logged in. Use logout first if you want to switch accounts.",
							}),
						},
					],
				};
			}

			const result = await requestOtp(phone_number);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							message: result.message,
							next_step: result.success
								? "Ask the user for the 6-digit OTP code, then call verify_otp."
								: "Check the error and try again.",
						}),
					},
				],
			};
		}
	);

	server.tool(
		"verify_otp",
		`Complete the Snoonu login by submitting the 6-digit OTP code the user received via SMS. Must be called after login — calling it without a prior login will fail.

On success, the session (cookies, auth token, device ID) is persisted to disk so future init_session calls restore it automatically. Returns whether login succeeded and the user's logged-in state.`,
		{
			otp_code: z
				.string()
				.describe("The 6-digit numeric OTP code the user received via SMS, e.g. '123456'"),
		},
		async ({ otp_code }) => {
			const result = await verifyOtp(otp_code);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: result.success,
							logged_in: result.loggedIn,
							message: result.message,
						}),
					},
				],
			};
		}
	);

	server.tool(
		"logout",
		`Clear the current Snoonu session and log out. Deletes saved cookies, auth token, and device ID from disk. After calling this, the user must log in again with login + verify_otp to use cart or checkout tools.

Use this when the user wants to switch accounts or explicitly log out. Search and browse tools will continue to work without login, but cart and checkout will not.`,
		{},
		async () => {
			await clearSession();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							success: true,
							message: "Session cleared. User is logged out.",
						}),
					},
				],
			};
		}
	);
}
