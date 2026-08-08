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
			"\n" +
			"  Set ONE of these environment variables and redeploy:\n" +
			"    MCP_AUTH_TOKEN=<secret>   require Authorization: Bearer <secret>\n" +
			"    ALLOW_ANONYMOUS=1         no auth (only for a genuinely private port)\n" +
			"\n" +
			"  Generate a token with:  openssl rand -hex 32\n" +
			"\n" +
			"  On Coolify/Docker this exit makes the container unhealthy, so the\n" +
			"  platform will roll back to the PREVIOUS image — you will keep seeing\n" +
			"  the old build's behaviour until this variable is set.\n" +
			"  For a container also set HOST=0.0.0.0, otherwise it binds to loopback\n" +
			"  and is unreachable from outside.",
	);
	process.exit(1);
}

const BIND_HOST = process.env.HOST || "127.0.0.1";
const isLoopbackBind = BIND_HOST === "127.0.0.1" || BIND_HOST === "localhost";

/**
 * Hostnames accepted in the Host header (DNS-rebinding protection).
 *
 * That protection exists to stop a browser on the SAME machine from reaching a
 * loopback-bound server via a rebound DNS name. A deliberately public
 * deployment has a different threat model — and defaulting to a localhost-only
 * allowlist there means every request to https://your-domain/mcp arrives with
 * Host: your-domain and gets a bare 403 that explains nothing.
 *
 * So: loopback bind keeps the strict localhost allowlist. A non-loopback bind
 * is an explicit choice to be reachable, so host checking is skipped unless
 * MCP_ALLOWED_HOSTS pins it down — with a warning, and with bearer auth still
 * mandatory.
 */
const explicitHosts = process.env.MCP_ALLOWED_HOSTS?.split(",")
	.map((h) => h.trim())
	.filter(Boolean);
const allowedHosts = explicitHosts ?? (isLoopbackBind ? localhostAllowedHostnames() : null);

const explicitOrigins = process.env.MCP_ALLOWED_ORIGINS?.split(",")
	.map((o) => o.trim())
	.filter(Boolean);
/** Browser Origins are never blanket-allowed; unset means localhost-only. */
const allowedOrigins = explicitOrigins ?? localhostAllowedOrigins();

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

/**
 * Replace an opaque 403 with one that names the env var to set. An operator
 * hitting a bare "Forbidden" from their own deployment has nothing to go on.
 */
function explainedRejection(res: Response, kind: "host" | "origin"): Response {
	const envVar = kind === "host" ? "MCP_ALLOWED_HOSTS" : "MCP_ALLOWED_ORIGINS";
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: {
				code: -32020,
				message:
					`Forbidden: request ${kind} is not allowed. Set ${envVar} to a ` +
					`comma-separated list including this ${kind} (e.g. ${envVar}=mcp.example.com), ` +
					`then restart the server.`,
			},
			id: null,
		}),
		{ status: res.status, headers: { "Content-Type": "application/json" } },
	);
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
	hostname: BIND_HOST,
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
		// Skipped only when bound to a non-loopback interface with no explicit
		// allowlist (see the note on allowedHosts).
		if (allowedHosts) {
			const hostRejection = hostHeaderValidationResponse(req, allowedHosts);
			if (hostRejection) {
				console.error(
					`[reject] Host "${req.headers.get("host")}" is not in MCP_ALLOWED_HOSTS ` +
						`(${allowedHosts.join(", ")}). Add it to MCP_ALLOWED_HOSTS.`,
				);
				return withCors(explainedRejection(hostRejection, "host"), req);
			}
		}

		const originRejection = originValidationResponse(req, allowedOrigins);
		if (originRejection) {
			console.error(
				`[reject] Origin "${req.headers.get("origin")}" is not in MCP_ALLOWED_ORIGINS ` +
					`(${allowedOrigins.join(", ")}). Add it to MCP_ALLOWED_ORIGINS.`,
			);
			return withCors(explainedRejection(originRejection, "origin"), req);
		}

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
	`Snoonu MCP HTTP server on http://${server.hostname}:${server.port}  (protocol 2026-07-28)`,
);
console.error(`  Health:  /health`);
console.error(`  MCP:     /mcp`);
console.error(`  Auth:    ${AUTH_TOKEN ? "bearer token required" : "ANONYMOUS (insecure)"}`);
console.error(
	`  Hosts:   ${allowedHosts ? allowedHosts.join(", ") : "any (not checked — non-loopback bind, MCP_ALLOWED_HOSTS unset)"}`,
);
console.error(`  Origins: ${allowedOrigins.join(", ")}`);
console.error(`  Store:   ${process.env.REDIS_URL ? "redis" : "disk"}`);

if (isLoopbackBind) {
	console.error(
		`\n  NOTE: bound to ${BIND_HOST}, so this is unreachable from outside this machine.\n` +
			`  For a container or remote host set HOST=0.0.0.0.`,
	);
}
if (!allowedHosts) {
	console.error(
		`\n  WARNING: Host header validation is OFF. Set MCP_ALLOWED_HOSTS=your.domain\n` +
			`  to re-enable DNS-rebinding protection.`,
	);
}

async function shutdown(): Promise<void> {
	await flush().catch(() => {});
	await handler.close().catch(() => {});
	await server.stop(true);
	process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
