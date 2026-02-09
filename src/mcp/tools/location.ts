// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Location MCP Tools
 * get_saved_addresses, set_delivery_location
 *
 * Only returns decision-relevant fields (id, label, address).
 * Lat/lng, phone, building details are internal plumbing the agent doesn't need.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSavedAddresses, setDeliveryLocation } from "../../lib/api-client";
import { isAuthenticated, getSession } from "../../lib/session-manager";
import { syncLocationToBrowser } from "../../lib/browser";

export function registerLocationTools(server: McpServer) {
	server.tool(
		"get_saved_addresses",
		`List all saved delivery addresses for the logged-in user. Returns each address's id, label (e.g. "Home", "Office"), and full address string, plus the currently active delivery location.

Requires login. Use the address id with set_delivery_location to switch where deliveries go. Changing location affects which merchants are available, delivery fees, and ETAs for all subsequent search and cart operations.`,
		{},
		async () => {
			if (!isAuthenticated()) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: true,
								message:
									"Must be logged in. Call init_session first, then login.",
							}),
						},
					],
				};
			}

			try {
				const addresses = await getSavedAddresses();
				const session = getSession();

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								current: session?.location?.address || null,
								addresses: addresses.map((a) => ({
									id: a.id,
									label: a.label,
									address: a.address,
								})),
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: true,
								message: `Failed to get addresses: ${error instanceof Error ? error.message : String(error)}`,
							}),
						},
					],
				};
			}
		},
	);

	server.tool(
		"set_delivery_location",
		`Switch the active delivery location to a saved address. This changes which merchants are available, delivery fees, ETAs, and product availability for ALL subsequent operations (search, cart, checkout).

Requires login. The address_id must come from a previous get_saved_addresses call. Updates the session's coordinates on disk and syncs the location to the browser cookie so the Snoonu website reflects the change.

Call get_saved_addresses first to show the user their options, then use this tool with their chosen address id.`,
		{
			address_id: z
				.number()
				.describe("Numeric address ID from a previous get_saved_addresses result, e.g. 12345"),
		},
		async ({ address_id }) => {
			if (!isAuthenticated()) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: true,
								message:
									"Must be logged in. Call init_session first, then login.",
							}),
						},
					],
				};
			}

			try {
				const address = await setDeliveryLocation(address_id);

				await syncLocationToBrowser(
					address_id,
					address.address,
					address.latitude,
					address.longitude,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								set: `${address.label} — ${address.address}`,
							}),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: true,
								message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
							}),
						},
					],
				};
			}
		},
	);
}
