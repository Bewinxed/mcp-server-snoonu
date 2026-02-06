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
		"Initialize Snoonu shopping session. Loads saved auth from disk and checks if user is logged in. Call this first before any other tool.",
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
		"Start OTP login flow. Opens browser, navigates to snoonu.com, enters phone number, and triggers OTP. After calling this, ask the user for the 6-digit OTP code they received, then call verify_otp.",
		{
			phone_number: z
				.string()
				.describe(
					"Phone number without country code (e.g., '55123456' for Qatar +974)"
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
		"Complete login by entering OTP code. Call this after `login` with the 6-digit code the user received.",
		{
			otp_code: z
				.string()
				.describe("6-digit OTP code received by the user"),
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
		"Clear saved session and log out.",
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
