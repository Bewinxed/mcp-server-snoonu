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
		"Get saved delivery addresses. Returns id, label, and address. Use the id with set_delivery_location to change delivery location.",
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
		"Set delivery location by address ID (from get_saved_addresses). Changes available merchants, delivery fees, and ETAs for all subsequent operations.",
		{
			address_id: z
				.number()
				.describe("Address ID from get_saved_addresses"),
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
