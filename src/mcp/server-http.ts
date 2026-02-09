/**
 * Snoonu Shopping MCP Server (HTTP / Streamable HTTP)
 *
 * Remote MCP server for hosting on Coolify, Docker, or any cloud.
 * Uses WebStandardStreamableHTTPServerTransport for Bun/Deno/CF Workers.
 *
 * Usage:
 *   PORT=3000 bun run src/mcp/server-http.ts
 *
 * Connect from Claude Desktop:
 *   URL: https://your-host.com/mcp
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createSnoonuServer } from "./create-server";

const PORT = Number(process.env.PORT) || 3000;

// Session tracking for stateful connections
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version",
		"Access-Control-Expose-Headers":
			"mcp-session-id, mcp-protocol-version",
	};
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// CORS preflight
		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		// Health check
		if (url.pathname === "/health") {
			return Response.json({ status: "ok" }, { headers: corsHeaders() });
		}

		// MCP endpoint
		if (url.pathname === "/mcp") {
			return handleMcp(req);
		}

		return new Response("Not Found", { status: 404 });
	},
});

async function handleMcp(req: Request): Promise<Response> {
	const sessionId = req.headers.get("mcp-session-id") ?? undefined;

	// Reuse existing session
	if (sessionId && transports.has(sessionId)) {
		const transport = transports.get(sessionId)!;
		const response = await transport.handleRequest(req);
		return addCors(response);
	}

	// New initialization request
	if (req.method === "POST") {
		const body = await req.json();

		if (isInitializeRequest(body)) {
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (sid) => {
					transports.set(sid, transport);
				},
			});

			transport.onclose = () => {
				const sid = transport.sessionId;
				if (sid) transports.delete(sid);
			};

			const server = createSnoonuServer();
			await server.connect(transport);

			const response = await transport.handleRequest(req, {
				parsedBody: body,
			});
			return addCors(response);
		}
	}

	return Response.json(
		{
			jsonrpc: "2.0",
			error: { code: -32000, message: "Bad Request: No valid session" },
			id: null,
		},
		{ status: 400, headers: corsHeaders() },
	);
}

function addCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(corsHeaders())) {
		headers.set(k, v);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

console.error(`Snoonu MCP HTTP server listening on port ${PORT}`);
console.error(`  Health: http://localhost:${PORT}/health`);
console.error(`  MCP:    http://localhost:${PORT}/mcp`);

process.on("SIGINT", async () => {
	for (const [sid, transport] of transports) {
		await transport.close().catch(() => {});
		transports.delete(sid);
	}
	process.exit(0);
});
process.on("SIGTERM", async () => {
	for (const [sid, transport] of transports) {
		await transport.close().catch(() => {});
		transports.delete(sid);
	}
	process.exit(0);
});
