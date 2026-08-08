// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Location MCP Tools
 * get_saved_addresses, set_delivery_location
 *
 * Only returns decision-relevant fields (id, label, address).
 * Lat/lng, phone, building details are internal plumbing the agent doesn't need.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getSavedAddresses, setDeliveryLocation } from "../../lib/api-client";
import { getSession } from "../../lib/session-manager";
import { syncLocationToBrowser } from "../../lib/browser";
import { ensureAuthenticated } from "../lib/auth";
import { ok, fail, authRequired } from "../lib/result";

export function registerLocationTools(server: McpServer) {
	server.registerTool(
		"get_saved_addresses",
		{
			title: "Get Saved Addresses",
			description: `List all saved delivery addresses for the logged-in user. Returns each address's id, label (e.g. "Home", "Office"), and full address string, plus the currently active delivery location.

Requires login. Use the address id with set_delivery_location to switch where deliveries go. Changing location affects which merchants are available, delivery fees, and ETAs for all subsequent search and cart operations.`,
			outputSchema: z.object({
				current: z.string().nullable().optional(),
				addresses: z.array(z.object({
					id: z.number(),
					label: z.string(),
					address: z.string(),
				})),
			}),
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			if (!(await ensureAuthenticated())) {
				return authRequired("get saved addresses");
			}

			try {
				const addresses = await getSavedAddresses();
				const session = getSession();

				return ok({
					current: session?.location?.address || null,
					addresses: addresses.map((a) => ({
						id: a.id,
						label: a.label,
						address: a.address,
					})),
				});
			} catch (error) {
				return fail(
					`Failed to get addresses: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	);

	server.registerTool(
		"set_delivery_location",
		{
			title: "Set Delivery Location",
			description: `Switch the active delivery location to a saved address. This changes which merchants are available, delivery fees, ETAs, and product availability for ALL subsequent operations (search, cart, checkout).

Requires login. The address_id must come from a previous get_saved_addresses call. Updates the session's coordinates on disk and syncs the location to the browser cookie so the Snoonu website reflects the change.

Call get_saved_addresses first to show the user their options, then use this tool with their chosen address id.`,
			inputSchema: z.object({
				address_id: z
					.number()
					.describe("Numeric address ID from a previous get_saved_addresses result, e.g. 12345"),
			}),
			outputSchema: z.object({
				set: z.string(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ address_id }) => {
			if (!(await ensureAuthenticated())) {
				return authRequired("set delivery location");
			}

			try {
				const address = await setDeliveryLocation(address_id);

				await syncLocationToBrowser(
					address_id,
					address.address,
					address.latitude,
					address.longitude,
				);

				return ok({
					set: `${address.label} — ${address.address}`,
				});
			} catch (error) {
				return fail(
					`Failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	);
}
