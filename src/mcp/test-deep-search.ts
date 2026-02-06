#!/usr/bin/env bun
/**
 * Quick test: compare broad vs deep search product counts at merchant level.
 */

import { spawn } from "child_process";
import * as path from "path";

const SERVER_PATH = path.join(import.meta.dir, "server.ts");

let nextId = 1;
function msg(method: string, params: Record<string, unknown> = {}) {
	return JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
}

async function run() {
	const proc = spawn("bun", ["run", SERVER_PATH], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	const responses: Record<number, any> = {};
	let buffer = "";
	proc.stdout!.on("data", (data: Buffer) => {
		buffer += data.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop()!;
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);
				if (parsed.id !== undefined) responses[parsed.id] = parsed;
			} catch {}
		}
	});

	function send(data: string) { proc.stdin!.write(data + "\n"); }
	async function wait(id: number, ms = 60000): Promise<any> {
		const start = Date.now();
		while (!responses[id]) {
			if (Date.now() - start > ms) throw new Error(`Timeout id=${id}`);
			await new Promise((r) => setTimeout(r, 50));
		}
		return responses[id];
	}

	try {
		// Init
		const iid = nextId;
		send(msg("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } }));
		await wait(iid);
		send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
		await new Promise((r) => setTimeout(r, 200));

		// Broad search
		console.log("--- Broad search: milk ---");
		const bid = nextId;
		send(msg("tools/call", { name: "search_products", arguments: { query: "milk", category: "Groceries", limit: 20 } }));
		const bRes = await wait(bid, 30000);
		const bData = JSON.parse(bRes.result?.content?.[0]?.text || "{}");
		console.log(`Flat products: ${bData.total_products}`);
		for (const m of (bData.merchants || []).slice(0, 5)) {
			console.log(`  ${m.name}: ${m.product_count} products, delivery=${m.delivery_fee_qar} QAR, ETA=${m.eta_minutes}min, rating=${m.rating}`);
		}

		// Deep search
		console.log("\n--- Deep search: milk ---");
		const did = nextId;
		send(msg("tools/call", { name: "search_products", arguments: { query: "milk", category: "Groceries", limit: 20, deep_search: true } }));
		const dRes = await wait(did, 60000);
		const dData = JSON.parse(dRes.result?.content?.[0]?.text || "{}");
		console.log(`Flat products: ${dData.total_products}`);
		for (const m of (dData.merchants || []).slice(0, 5)) {
			console.log(`  ${m.name}: ${m.product_count} products, delivery=${m.delivery_fee_qar} QAR, ETA=${m.eta_minutes}min, rating=${m.rating}`);
		}

		// Compare per-merchant
		console.log("\n--- Per-merchant comparison ---");
		const broadMap = new Map<string, number>((bData.merchants || []).map((m: any) => [m.id, m.product_count]));
		for (const m of (dData.merchants || []).slice(0, 8)) {
			const broadCount = broadMap.get(m.id) ?? 0;
			const diff = m.product_count - broadCount;
			const icon = diff > 0 ? "📈" : diff === 0 ? "➡️" : "📉";
			console.log(`  ${icon} ${m.name}: broad=${broadCount} → deep=${m.product_count} (${diff >= 0 ? "+" : ""}${diff})`);
		}
	} finally {
		proc.kill();
	}
}

run().catch(console.error);
