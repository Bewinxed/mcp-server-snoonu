// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-end tests: drive the built stdio server with a real MCP client.
 *
 * Network-dependent tests hit the live Snoonu API and are skipped when
 * SNOONU_OFFLINE=1.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";

const OFFLINE = process.env.SNOONU_OFFLINE === "1";

function connect(): Promise<Client> {
	const transport = new StdioClientTransport({
		command: "bun",
		args: ["run", join(import.meta.dir, "..", "src", "mcp", "server.ts")],
		cwd: join(import.meta.dir, ".."),
		stderr: "pipe",
	});
	const client = new Client({ name: "test", version: "1.0.0" });
	return client.connect(transport).then(() => client);
}

function body(res: any): any {
	return JSON.parse(res.content[0].text);
}

let client: Client;

beforeAll(async () => {
	client = await connect();
});

afterAll(async () => {
	await client?.close();
});

describe("protocol", () => {
	test("advertises name and a non-placeholder version", async () => {
		const info = client.getServerVersion();
		expect(info?.name).toBe("mcp-server-snoonu");
		// Regression: server used to report 0.1.0 while package.json said 0.2.5.
		const pkg = await Bun.file(
			join(import.meta.dir, "..", "package.json"),
		).json();
		expect(info?.version).toBe(pkg.version);
	});

	test("exposes server instructions", () => {
		const instructions = client.getInstructions();
		expect(instructions).toBeTruthy();
		expect(instructions).toContain("Snoonu");
	});

	test("every tool has a title, annotations, and an output schema", async () => {
		const { tools } = await client.listTools();
		expect(tools.length).toBeGreaterThanOrEqual(19);
		for (const t of tools) {
			expect(t.title, `${t.name} missing title`).toBeTruthy();
			expect(t.annotations, `${t.name} missing annotations`).toBeTruthy();
			expect(t.outputSchema, `${t.name} missing outputSchema`).toBeTruthy();
		}
	});

	test("place_order is annotated destructive", async () => {
		const { tools } = await client.listTools();
		const placeOrder = tools.find((t) => t.name === "place_order");
		expect(placeOrder?.annotations?.destructiveHint).toBe(true);
		expect(placeOrder?.annotations?.readOnlyHint).toBe(false);
	});

	test("read-only tools are annotated read-only", async () => {
		const { tools } = await client.listTools();
		for (const name of [
			"search_products",
			"bulk_search",
			"get_cart",
			"browse_categories",
			"get_product_details",
		]) {
			const tool = tools.find((t) => t.name === name);
			expect(tool?.annotations?.readOnlyHint, `${name}`).toBe(true);
		}
	});
});

describe("input validation", () => {
	test("rejects an empty query instead of silently returning nothing", async () => {
		const res: any = await client.callTool({
			name: "search_products",
			arguments: { query: "" },
		});
		expect(res.isError).toBe(true);
	});

	test("rejects an unknown enum value", async () => {
		const res: any = await client.callTool({
			name: "search_products",
			arguments: { query: "milk", category: "NotACategory" },
		});
		expect(res.isError).toBe(true);
	});
});

describe("error signalling", () => {
	test("unknown product id sets isError (was silently a success)", async () => {
		const res: any = await client.callTool({
			name: "get_product_details",
			arguments: { product_id: "definitely-not-a-real-id" },
		});
		expect(res.isError).toBe(true);
		expect(body(res).message).toContain("not known");
	});

	test("cart mutation without auth sets isError", async () => {
		const res: any = await client.callTool({
			name: "add_to_cart",
			arguments: { items: [{ product_id: "x", quantity: 1 }] },
		});
		expect(res.isError).toBe(true);
	});

	test("checkout without auth sets isError", async () => {
		const res: any = await client.callTool({
			name: "go_to_checkout",
			arguments: {},
		});
		expect(res.isError).toBe(true);
	});
});

describe("structured output", () => {
	test("successful calls carry structuredContent", async () => {
		const res: any = await client.callTool({
			name: "browse_categories",
			arguments: {},
		});
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent).toBeTruthy();
		expect(res.structuredContent.categories.length).toBeGreaterThan(0);
	});

	test("get_cart reports an empty cart cleanly", async () => {
		const res: any = await client.callTool({
			name: "get_cart",
			arguments: {},
		});
		expect(res.isError).toBeFalsy();
		expect(Array.isArray(res.structuredContent.items)).toBe(true);
	});
});

describe.skipIf(OFFLINE)("live search", () => {
	test("search_products returns real merchants and products", async () => {
		const res: any = await client.callTool(
			{ name: "search_products", arguments: { query: "milk" } },
			undefined,
			{ timeout: 90_000 },
		);
		expect(res.isError).toBeFalsy();
		const data = res.structuredContent;
		expect(data.merchants).toBeGreaterThan(0);
		expect(data.cheapest.length).toBeGreaterThan(0);
		expect(data.cheapest[0].id).toBeTruthy();
		expect(typeof data.cheapest[0].price).toBe("number");
	}, 120_000);

	test("bulk_search handles multiple queries", async () => {
		const res: any = await client.callTool(
			{ name: "bulk_search", arguments: { queries: ["bread", "eggs"] } },
			undefined,
			{ timeout: 90_000 },
		);
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.results.length).toBe(2);
	}, 120_000);

	/**
	 * Regression test for the headline bug: a product id from a search in one
	 * process used to be unresolvable in the next, because the cache was a
	 * module-level Map.
	 */
	test("a product id from one process resolves in a fresh process", async () => {
		const search: any = await client.callTool(
			{ name: "search_products", arguments: { query: "milk" } },
			undefined,
			{ timeout: 90_000 },
		);
		const productId = search.structuredContent.cheapest[0].id;
		expect(productId).toBeTruthy();

		const fresh = await connect();
		try {
			const details: any = await fresh.callTool(
				{ name: "get_product_details", arguments: { product_id: productId } },
				undefined,
				{ timeout: 60_000 },
			);
			expect(details.isError).toBeFalsy();
			expect(details.structuredContent.id).toBe(productId);
			expect(details.structuredContent.name).toBeTruthy();
			expect(typeof details.structuredContent.price).toBe("number");
		} finally {
			await fresh.close();
		}
	}, 180_000);
});
