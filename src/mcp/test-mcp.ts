#!/usr/bin/env bun
/**
 * End-to-end test for Snoonu MCP server.
 * Spawns the server as a child process, talks JSON-RPC over stdio.
 */

import { spawn } from "child_process";
import * as path from "path";

const SERVER_PATH = path.join(import.meta.dir, "server.ts");

let nextId = 1;
function msg(method: string, params: Record<string, unknown> = {}) {
	return JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
}
function notification(method: string, params: Record<string, unknown> = {}) {
	return JSON.stringify({ jsonrpc: "2.0", method, params });
}

async function runTests() {
	const proc = spawn("bun", ["run", SERVER_PATH], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	const responses: Record<number, any> = {};
	let buffer = "";

	proc.stdout!.on("data", (data: Buffer) => {
		buffer += data.toString();
		// Parse newline-delimited JSON
		const lines = buffer.split("\n");
		buffer = lines.pop()!; // keep incomplete line
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);
				if (parsed.id !== undefined) {
					responses[parsed.id] = parsed;
				}
			} catch {}
		}
	});

	let stderr = "";
	proc.stderr!.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	function send(data: string) {
		proc.stdin!.write(data + "\n");
	}

	async function waitForResponse(id: number, timeoutMs = 30000): Promise<any> {
		const start = Date.now();
		while (!responses[id]) {
			if (Date.now() - start > timeoutMs) {
				throw new Error(`Timeout waiting for response id=${id} after ${timeoutMs}ms`);
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		return responses[id];
	}

	const results: { name: string; pass: boolean; detail: string }[] = [];

	function test(name: string, pass: boolean, detail: string) {
		results.push({ name, pass, detail });
		const icon = pass ? "✅" : "❌";
		console.log(`${icon} ${name}: ${detail}`);
	}

	try {
		// --- Initialize ---
		const initId = nextId;
		send(
			msg("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test-runner", version: "1.0" },
			})
		);
		const initRes = await waitForResponse(initId);
		test(
			"MCP initialize",
			!!initRes.result?.serverInfo?.name,
			`server=${initRes.result?.serverInfo?.name}, version=${initRes.result?.serverInfo?.version}`
		);

		// Send initialized notification
		send(notification("notifications/initialized"));
		await new Promise((r) => setTimeout(r, 200));

		// --- tools/list ---
		const listId = nextId;
		send(msg("tools/list", {}));
		const listRes = await waitForResponse(listId);
		const toolNames: string[] = (listRes.result?.tools || []).map(
			(t: any) => t.name
		);
		test(
			"tools/list",
			toolNames.length === 14,
			`${toolNames.length} tools: ${toolNames.join(", ")}`
		);

		const expectedTools = [
			"init_session",
			"login",
			"verify_otp",
			"logout",
			"search_products",
			"search_in_merchant",
			"add_to_cart",
			"get_cart",
			"remove_from_cart",
			"clear_cart",
			"go_to_checkout",
			"browse_categories",
			"get_saved_addresses",
			"set_delivery_location",
		];
		for (const tool of expectedTools) {
			test(
				`tool registered: ${tool}`,
				toolNames.includes(tool),
				toolNames.includes(tool) ? "present" : "MISSING"
			);
		}

		// --- Validate schemas ---
		const searchTool = (listRes.result?.tools || []).find(
			(t: any) => t.name === "search_products"
		);
		const searchProps = searchTool?.inputSchema?.properties || {};
		test(
			"search_products has deep_search param",
			!!searchProps.deep_search,
			searchProps.deep_search ? `type=${searchProps.deep_search.type}` : "MISSING"
		);
		test(
			"search_products has query param (required)",
			(searchTool?.inputSchema?.required || []).includes("query"),
			"query is required"
		);

		const addCartTool = (listRes.result?.tools || []).find(
			(t: any) => t.name === "add_to_cart"
		);
		test(
			"add_to_cart items is array",
			addCartTool?.inputSchema?.properties?.items?.type === "array",
			`type=${addCartTool?.inputSchema?.properties?.items?.type}`
		);

		// --- Call init_session ---
		const initSessId = nextId;
		send(
			msg("tools/call", { name: "init_session", arguments: {} })
		);
		const initSessRes = await waitForResponse(initSessId);
		const initSessData = JSON.parse(
			initSessRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"init_session executes",
			initSessData.success === true,
			`logged_in=${initSessData.logged_in}, message=${initSessData.message?.substring(0, 60)}`
		);

		// --- Call browse_categories ---
		const browseId = nextId;
		send(msg("tools/call", { name: "browse_categories", arguments: {} }));
		const browseRes = await waitForResponse(browseId);
		const browseData = JSON.parse(
			browseRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"browse_categories returns categories",
			Array.isArray(browseData.categories) && browseData.categories.length === 5,
			`count=${browseData.categories?.length}, names=${browseData.categories?.map((c: any) => c.name).join(", ")}`
		);

		// --- Call get_saved_addresses ---
		const addrId = nextId;
		send(msg("tools/call", { name: "get_saved_addresses", arguments: {} }));
		const addrRes = await waitForResponse(addrId, 15000);
		const addrData = JSON.parse(
			addrRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"get_saved_addresses returns addresses",
			addrData.success === true && addrData.address_count > 0,
			`count=${addrData.address_count}, first=${addrData.addresses?.[0]?.label}: ${addrData.addresses?.[0]?.address?.substring(0, 40)}`
		);

		// Validate address shape
		if (addrData.addresses?.length > 0) {
			const a = addrData.addresses[0];
			test(
				"address has required fields",
				!!a.id && !!a.address && typeof a.latitude === "number" && typeof a.longitude === "number",
				`id=${a.id}, lat=${a.latitude}, lng=${a.longitude}`
			);
		}

		// --- Call set_delivery_location ---
		if (addrData.addresses?.length > 0) {
			const targetAddr = addrData.addresses[0];
			const setLocId = nextId;
			send(msg("tools/call", {
				name: "set_delivery_location",
				arguments: { address_id: targetAddr.id },
			}));
			const setLocRes = await waitForResponse(setLocId, 15000);
			const setLocData = JSON.parse(
				setLocRes.result?.content?.[0]?.text || "{}"
			);
			test(
				"set_delivery_location works",
				setLocData.success === true,
				`message=${setLocData.message?.substring(0, 60)}`
			);
			test(
				"set_delivery_location returns coordinates",
				typeof setLocData.location?.latitude === "number",
				`lat=${setLocData.location?.latitude}, lng=${setLocData.location?.longitude}`
			);
		}

		// --- Call search_products (live API) ---
		const searchId = nextId;
		send(
			msg("tools/call", {
				name: "search_products",
				arguments: { query: "milk", category: "Groceries", limit: 5 },
			})
		);
		const searchRes = await waitForResponse(searchId, 30000);
		const searchData = JSON.parse(
			searchRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"search_products returns results",
			searchData.success === true && searchData.total_products > 0,
			`products=${searchData.total_products}, merchants=${searchData.merchants_found}`
		);

		// Validate product shape
		if (searchData.products?.length > 0) {
			const p = searchData.products[0];
			const hasRequiredFields =
				p.product_id && p.name && typeof p.price === "number" && p.merchant;
			test(
				"product has required fields",
				!!hasRequiredFields,
				`product_id=${p.product_id?.substring(0, 12)}, name=${p.name}, price=${p.price}, merchant=${p.merchant}`
			);
			test(
				"product has delivery_fee_qar",
				typeof p.delivery_fee_qar === "number",
				`delivery_fee_qar=${p.delivery_fee_qar}`
			);
			test(
				"product has eta_minutes",
				typeof p.eta_minutes === "number",
				`eta_minutes=${p.eta_minutes}`
			);
		}

		// Validate merchant shape
		if (searchData.merchants?.length > 0) {
			const m = searchData.merchants[0];
			test(
				"merchant has delivery_fee_qar",
				typeof m.delivery_fee_qar === "number",
				`delivery_fee_qar=${m.delivery_fee_qar}`
			);
			test(
				"merchant has menu_id",
				typeof m.menu_id === "number",
				`menu_id=${m.menu_id}`
			);
			test(
				"merchant has products array",
				Array.isArray(m.products),
				`product_count=${m.products?.length}`
			);
			test(
				"merchant has rating",
				typeof m.rating === "number",
				`rating=${m.rating}`
			);
		}

		// --- Call search_products with deep_search ---
		const deepId = nextId;
		send(
			msg("tools/call", {
				name: "search_products",
				arguments: { query: "milk", category: "Groceries", limit: 5, deep_search: true },
			})
		);
		const deepRes = await waitForResponse(deepId, 60000);
		const deepData = JSON.parse(
			deepRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"deep_search returns results",
			deepData.success === true && deepData.total_products > 0,
			`products=${deepData.total_products}, merchants=${deepData.merchants_found}, deep_search=${deepData.deep_search}`
		);
		test(
			"deep_search flag echoed",
			deepData.deep_search === true,
			`deep_search=${deepData.deep_search}`
		);

		// Compare: deep search should find >= as many products as broad
		if (searchData.total_products > 0 && deepData.total_products > 0) {
			test(
				"deep_search finds >= broad results",
				deepData.total_products >= searchData.total_products,
				`deep=${deepData.total_products} vs broad=${searchData.total_products}`
			);
		}

		// --- Call get_cart (should work even without login — returns empty) ---
		const cartId = nextId;
		send(msg("tools/call", { name: "get_cart", arguments: {} }));
		const cartRes = await waitForResponse(cartId);
		const cartData = JSON.parse(
			cartRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"get_cart executes",
			cartData.success === true,
			`empty=${cartData.empty}, items_count=${cartData.items_count}`
		);

		// --- Call add_to_cart without login (should fail gracefully) ---
		const addId = nextId;
		send(
			msg("tools/call", {
				name: "add_to_cart",
				arguments: { items: [{ product_id: "fake-id", quantity: 1 }] },
			})
		);
		const addRes = await waitForResponse(addId);
		const addData = JSON.parse(
			addRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"add_to_cart requires login",
			addData.success === false &&
				addData.message?.toLowerCase().includes("logged in"),
			`message=${addData.message?.substring(0, 60)}`
		);

		// --- Call logout ---
		const logoutId = nextId;
		send(msg("tools/call", { name: "logout", arguments: {} }));
		const logoutRes = await waitForResponse(logoutId);
		const logoutData = JSON.parse(
			logoutRes.result?.content?.[0]?.text || "{}"
		);
		test(
			"logout executes",
			logoutData.success === true,
			logoutData.message
		);

	} catch (error) {
		console.error(`\n💥 Test runner error: ${error}`);
	} finally {
		proc.kill();

		// Summary
		const passed = results.filter((r) => r.pass).length;
		const failed = results.filter((r) => !r.pass).length;
		console.log(`\n${"=".repeat(60)}`);
		console.log(`Tests: ${passed} passed, ${failed} failed, ${results.length} total`);

		if (stderr.trim()) {
			console.log(`\nStderr output:\n${stderr.substring(0, 500)}`);
		}

		if (failed > 0) {
			console.log("\nFailed tests:");
			for (const r of results.filter((r) => !r.pass)) {
				console.log(`  ❌ ${r.name}: ${r.detail}`);
			}
		}

		process.exit(failed > 0 ? 1 : 0);
	}
}

runTests();
