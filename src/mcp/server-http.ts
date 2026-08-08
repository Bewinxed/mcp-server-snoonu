// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Snoonu Shopping MCP Server (Streamable HTTP)
 *
 * Remote MCP server for hosting on Coolify, Docker, or any cloud.
 *
 * Usage:
 *   PORT=3000 bun run src/mcp/server-http.ts
 *
 * MCP 2026-07-28 removed protocol sessions, so there is no session map here
 * any more: `createMcpHandler` builds a fresh server per request and durable
 * state lives in ./lib/store.ts. Set REDIS_URL to share that state across
 * replicas.
 *
 * SECURITY
 * --------
 * This endpoint drives a logged-in shopping session and can place real orders.
 * The previous version had no auth and `Access-Control-Allow-Origin: *`, so
 * anyone who could reach the port could spend the host's money. Now:
 *   - Set MCP_AUTH_TOKEN to require `Authorization: Bearer <token>`.
 *     Refusing to start without it is deliberate; opt out with ALLOW_ANONYMOUS=1.
 *   - Host/Origin are validated (DNS-rebinding protection, required by spec).
 *   - CORS defaults to closed; set MCP_ALLOWED_ORIGINS to a comma-separated list.
 */

import {
	createMcpHandler,
	hostHeaderValidationResponse,
	originValidationResponse,
	localhostAllowedHostnames,
	localhostAllowedOrigins,
} from "@modelcontextprotocol/server";
import { createSnoonuServer } from "./create-server";
import { flush } from "./lib/store";

const PORT = Number(process.env.PORT) || 3000;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS === "1";

if (!AUTH_TOKEN && !ALLOW_ANONYMOUS) {
	console.error(
		"[fatal] Refusing to start without authentication.\n" +
			"  This server can place real orders using the host's Snoonu session.\n" +
			"  Set MCP_AUTH_TOKEN=<secret> to require a bearer token,\n" +
			"  or ALLOW_ANONYMOUS=1 if you are certain the port is private.",
	);
	process.exit(1);
}

/** Hostnames accepted in the Host header. Defaults to localhost-only. */
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
	? process.env.MCP_ALLOWED_HOSTS.split(",").map((h) => h.trim())
	: localhostAllowedHostnames();

/** Origin hostnames accepted for browser-initiated requests. */
const allowedOrigins = process.env.MCP_ALLOWED_ORIGINS
	? process.env.MCP_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
	: localhostAllowedOrigins();

const handler = createMcpHandler(createSnoonuServer);

/** Constant-time-ish comparison to avoid trivially leaking the token by timing. */
function tokenMatches(provided: string, expected: string): boolean {
	if (provided.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < provided.length; i++) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

function unauthorized(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code: -32001, message: "Unauthorized" },
			id: null,
		}),
		{
			status: 401,
			headers: {
				"Content-Type": "application/json",
				"WWW-Authenticate": 'Bearer realm="mcp-server-snoonu"',
			},
		},
	);
}

function corsHeaders(req: Request): Record<string, string> {
	const origin = req.headers.get("origin");
	if (!origin) return {};
	let hostname: string;
	try {
		hostname = new URL(origin).hostname;
	} catch {
		return {};
	}
	if (!allowedOrigins.includes(hostname)) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, Authorization, Mcp-Method, Mcp-Name, mcp-protocol-version",
		"Access-Control-Expose-Headers": "mcp-protocol-version",
		Vary: "Origin",
	};
}

function withCors(res: Response, req: Request): Response {
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

const server = Bun.serve({
	port: PORT,
	// Bind to loopback unless explicitly told otherwise.
	hostname: process.env.HOST || "127.0.0.1",
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url);

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(req) });
		}

		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname !== "/mcp") {
			return new Response("Not Found", { status: 404 });
		}

		// DNS-rebinding protection — required for HTTP transports by the spec.
		const hostRejection = hostHeaderValidationResponse(req, allowedHosts);
		if (hostRejection) return withCors(hostRejection, req);

		const originRejection = originValidationResponse(req, allowedOrigins);
		if (originRejection) return withCors(originRejection, req);

		if (AUTH_TOKEN) {
			const header = req.headers.get("authorization") ?? "";
			const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
			if (!provided || !tokenMatches(provided, AUTH_TOKEN)) {
				return withCors(unauthorized(), req);
			}
		}

		return withCors(await handler.fetch(req), req);
	},
});

console.error(
	`Snoonu MCP HTTP server on http://${server.hostname}:${server.port}`,
);
console.error(`  Health: /health`);
console.error(`  MCP:    /mcp`);
console.error(`  Auth:   ${AUTH_TOKEN ? "bearer token required" : "ANONYMOUS (insecure)"}`);

async function shutdown(): Promise<void> {
	await flush().catch(() => {});
	await handler.close().catch(() => {});
	await server.stop(true);
	process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
