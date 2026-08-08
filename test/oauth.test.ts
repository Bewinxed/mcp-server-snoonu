// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drives the full OAuth authorization-code + PKCE flow against the real HTTP
 * server, the way an MCP client does it.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

const PORT = 4610;
const BASE = `http://localhost:${PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
	proc = Bun.spawn(["bun", "run", "src/mcp/server-http.ts"], {
		cwd: new URL("..", import.meta.url).pathname,
		env: {
			...process.env,
			PORT: String(PORT),
			HOST: "127.0.0.1",
			MCP_PUBLIC_URL: BASE,
			MCP_OAUTH_SIGNING_KEY: "test-key-do-not-use-in-production",
			MCP_AUTH_TOKEN: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	// Wait for readiness rather than sleeping a fixed amount.
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch(`${BASE}/health`);
			if (r.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error("server did not become healthy");
});

afterAll(() => proc?.kill());

const pkce = () => {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
};

describe("discovery", () => {
	test("unauthenticated /mcp returns 401 with a resource_metadata challenge", async () => {
		const res = await fetch(`${BASE}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(res.status).toBe(401);
		const challenge = res.headers.get("www-authenticate") ?? "";
		expect(challenge).toContain("Bearer");
		expect(challenge).toContain("resource_metadata=");
	});

	test("protected resource metadata is served without a token", async () => {
		const res = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`);
		expect(res.status).toBe(200);
		const doc = await res.json();
		expect(doc.resource).toBe(`${BASE}/mcp`);
		expect(doc.authorization_servers).toContain(BASE);
	});

	test("authorization server metadata advertises PKCE and resource indicators", async () => {
		const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
		expect(res.status).toBe(200);
		const doc = await res.json();
		expect(doc.code_challenge_methods_supported).toContain("S256");
		expect(doc.resource_indicators_supported).toBe(true);
		expect(doc.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
		expect(doc.token_endpoint).toBe(`${BASE}/oauth/token`);
	});
});

describe("authorization code + PKCE", () => {
	test("full flow yields a token that opens /mcp", async () => {
		// 1. Register (DCR)
		const reg = await fetch(`${BASE}/oauth/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				redirect_uris: ["http://localhost:9999/callback"],
				client_name: "test-client",
			}),
		});
		expect(reg.status).toBe(201);
		const { client_id } = await reg.json();
		expect(client_id).toBeTruthy();

		// 2. Authorize
		const { verifier, challenge } = pkce();
		const params = new URLSearchParams({
			client_id,
			redirect_uri: "http://localhost:9999/callback",
			response_type: "code",
			state: "xyz",
			code_challenge: challenge,
			code_challenge_method: "S256",
			resource: `${BASE}/mcp`,
		});

		const consent = await fetch(`${BASE}/oauth/authorize?${params}`);
		expect(consent.status).toBe(200);
		expect(await consent.text()).toContain("Approve access");

		const approve = await fetch(`${BASE}/oauth/authorize`, {
			method: "POST",
			body: new URLSearchParams({
				client_id,
				redirect_uri: "http://localhost:9999/callback",
				state: "xyz",
				code_challenge: challenge,
				code_challenge_method: "S256",
				resource: `${BASE}/mcp`,
				scope: "snoonu:read snoonu:write",
			}),
			redirect: "manual",
		});
		expect(approve.status).toBe(302);
		const location = new URL(approve.headers.get("location")!);
		const code = location.searchParams.get("code")!;
		expect(code).toBeTruthy();
		expect(location.searchParams.get("state")).toBe("xyz");
		// RFC 9207
		expect(location.searchParams.get("iss")).toBe(BASE);

		// 3. Exchange
		const tokenRes = await fetch(`${BASE}/oauth/token`, {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: "http://localhost:9999/callback",
				client_id,
				code_verifier: verifier,
				resource: `${BASE}/mcp`,
			}),
		});
		expect(tokenRes.status).toBe(200);
		const token = await tokenRes.json();
		expect(token.token_type).toBe("Bearer");
		expect(token.access_token).toBeTruthy();

		// 4. Use it
		const mcp = await fetch(`${BASE}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${token.access_token}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "t", version: "1" },
				},
			}),
		});
		expect(mcp.status).toBe(200);
		expect(await mcp.text()).toContain("mcp-server-snoonu");
	});

	test("a reused authorization code is rejected", async () => {
		const { verifier, challenge } = pkce();
		const common = {
			client_id: "public-client",
			redirect_uri: "http://localhost:9999/callback",
			code_challenge: challenge,
			code_challenge_method: "S256",
			resource: `${BASE}/mcp`,
			scope: "snoonu:read",
		};
		const approve = await fetch(`${BASE}/oauth/authorize`, {
			method: "POST",
			body: new URLSearchParams(common),
			redirect: "manual",
		});
		const code = new URL(approve.headers.get("location")!).searchParams.get("code")!;

		const body = () =>
			new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: common.redirect_uri,
				client_id: common.client_id,
				code_verifier: verifier,
			});

		expect((await fetch(`${BASE}/oauth/token`, { method: "POST", body: body() })).status).toBe(200);
		const second = await fetch(`${BASE}/oauth/token`, { method: "POST", body: body() });
		expect(second.status).toBe(400);
		expect((await second.json()).error).toBe("invalid_grant");
	});

	test("a wrong PKCE verifier is rejected", async () => {
		const { challenge } = pkce();
		const approve = await fetch(`${BASE}/oauth/authorize`, {
			method: "POST",
			body: new URLSearchParams({
				client_id: "public-client",
				redirect_uri: "http://localhost:9999/callback",
				code_challenge: challenge,
				code_challenge_method: "S256",
				resource: `${BASE}/mcp`,
			}),
			redirect: "manual",
		});
		const code = new URL(approve.headers.get("location")!).searchParams.get("code")!;

		const res = await fetch(`${BASE}/oauth/token`, {
			method: "POST",
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: "http://localhost:9999/callback",
				client_id: "public-client",
				code_verifier: "wrong-verifier-entirely",
			}),
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_grant");
	});

	test("PKCE is mandatory — plain method is refused", async () => {
		const res = await fetch(
			`${BASE}/oauth/authorize?${new URLSearchParams({
				client_id: "c",
				redirect_uri: "http://localhost:9999/callback",
				code_challenge: "abc",
				code_challenge_method: "plain",
			})}`,
		);
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("S256");
	});

	test("a garbage token is rejected", async () => {
		const res = await fetch(`${BASE}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer not-a-real-token",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(res.status).toBe(401);
	});
});
