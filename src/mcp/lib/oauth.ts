// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal OAuth 2.1 Authorization Server + token verifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * MCP clients (Claude Code's connector page, Claude Desktop, VS Code) authorise
 * against a remote MCP server via OAuth. They do NOT understand a hand-shared
 * static bearer token — which is all this server had, so "Connect" could never
 * work.
 *
 * The spec models an MCP server as an OAuth *Resource Server* that points at an
 * Authorization Server through RFC 9728 Protected Resource Metadata. That
 * assumes you already run an AS. For a single-user self-hosted shopping server
 * that is absurd overhead, so this module is a small AS covering exactly the
 * flow MCP clients use:
 *
 *   authorization code + PKCE (S256 required), RFC 8707 resource binding,
 *   RFC 8414 AS metadata, and open registration for public clients.
 *
 * Point MCP_OAUTH_ISSUER at an external AS instead and this is bypassed
 * entirely — see server-http.ts.
 *
 * SCOPE OF TRUST
 * --------------
 * This authorises access to ONE Snoonu session — the one on this host. It is a
 * gate in front of your own account, not a multi-tenant identity system.
 * Approval is therefore a single shared passphrase (MCP_OAUTH_PASSWORD).
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

/**
 * The SDK maps OAuthError -> 401/403 with the WWW-Authenticate challenge.
 * A plain Error becomes a 500, which loses the challenge and leaves the client
 * with no way to discover the Authorization Server.
 */
function invalidToken(message: string): OAuthError {
	return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

const b64url = (b: Buffer | string): string =>
	Buffer.from(b).toString("base64url");

/** Signing key for issued tokens. Generated per-process if not configured. */
const SIGNING_KEY =
	process.env.MCP_OAUTH_SIGNING_KEY || randomBytes(32).toString("hex");

if (!process.env.MCP_OAUTH_SIGNING_KEY) {
	console.error(
		"[oauth] MCP_OAUTH_SIGNING_KEY not set — generated an ephemeral key.\n" +
			"        Issued tokens become invalid on restart, and replicas will\n" +
			"        reject each other's tokens. Set it to persist sessions:\n" +
			"          MCP_OAUTH_SIGNING_KEY=$(openssl rand -hex 32)",
	);
}

const ACCESS_TOKEN_TTL_S = Number(process.env.MCP_OAUTH_TOKEN_TTL || 60 * 60 * 24 * 30);
const CODE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Token issuing / verification (self-contained, HMAC-signed)
// ---------------------------------------------------------------------------

interface TokenClaims {
	sub: string;
	aud: string; // RFC 8707 resource this token is valid for
	iss: string;
	client_id: string;
	scope: string;
	exp: number;
	iat: number;
	jti: string;
}

function sign(payload: TokenClaims): string {
	const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = b64url(JSON.stringify(payload));
	const data = `${header}.${body}`;
	const sig = createHmac("sha256", SIGNING_KEY).update(data).digest("base64url");
	return `${data}.${sig}`;
}

function verify(token: string): TokenClaims | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [header, body, sig] = parts as [string, string, string];
	const expected = createHmac("sha256", SIGNING_KEY)
		.update(`${header}.${body}`)
		.digest("base64url");
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	try {
		return JSON.parse(Buffer.from(body, "base64url").toString()) as TokenClaims;
	} catch {
		return null;
	}
}

/**
 * OAuthTokenVerifier for the SDK's requireBearerAuth().
 *
 * Audience binding is the part implementers most often skip: a token minted for
 * a different resource must be rejected, or this server happily accepts tokens
 * issued for someone else's.
 */
export function createVerifier(resourceUrl: string, issuer: string) {
	return {
		async verifyAccessToken(token: string) {
			const claims = verify(token);
			if (!claims) throw invalidToken("token signature is not valid");
			if (claims.iss !== issuer) throw invalidToken("token issuer mismatch");

			const strip = (u: string) => u.split("#")[0]!.replace(/\/$/, "");
			if (strip(claims.aud) !== strip(resourceUrl)) {
				throw invalidToken(
					`token audience "${claims.aud}" does not match this resource "${resourceUrl}"`,
				);
			}
			if (claims.exp * 1000 < Date.now()) throw invalidToken("token has expired");

			return {
				token,
				clientId: claims.client_id,
				scopes: claims.scope ? claims.scope.split(" ") : [],
				expiresAt: claims.exp,
				resource: new URL(claims.aud),
				extra: { sub: claims.sub },
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Authorization codes + registered clients (in memory)
// ---------------------------------------------------------------------------

interface PendingCode {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string;
	scope: string;
	expiresAt: number;
}

const codes = new Map<string, PendingCode>();
const clients = new Map<string, { redirectUris: string[]; name?: string }>();

function sweep(): void {
	const now = Date.now();
	for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);
}

export interface OAuthConfig {
	issuer: string;
	resource: string;
	password?: string;
}

export const SUPPORTED_SCOPES = ["snoonu:read", "snoonu:write"];

/** RFC 8414 Authorization Server Metadata. */
export function authorizationServerMetadata(cfg: OAuthConfig) {
	return {
		issuer: cfg.issuer,
		authorization_endpoint: `${cfg.issuer}/oauth/authorize`,
		token_endpoint: `${cfg.issuer}/oauth/token`,
		registration_endpoint: `${cfg.issuer}/oauth/register`,
		scopes_supported: SUPPORTED_SCOPES,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
		// RFC 8707 — clients MUST send `resource` on authorize and token.
		resource_indicators_supported: true,
		authorization_response_iss_parameter_supported: true,
	};
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

function html(body: string, status = 200): Response {
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snoonu MCP</title><style>
:root{color-scheme:light dark}
body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0c;color:#e8e8ea}
.card{max-width:26rem;padding:2rem;border:1px solid #26262a;border-radius:14px;background:#141416}
h1{font-size:1.15rem;margin:0 0 .5rem}
p{color:#a1a1aa;font-size:.9rem;line-height:1.5;margin:.5rem 0}
input{width:100%;padding:.6rem .7rem;margin:.75rem 0;border-radius:8px;border:1px solid #34343a;background:#0b0b0c;color:inherit;font-size:1rem;box-sizing:border-box}
button{width:100%;padding:.65rem;border:0;border-radius:8px;background:#e11d48;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
code{background:#1e1e22;padding:.1rem .35rem;border-radius:4px;font-size:.82rem}
.warn{border-left:3px solid #e11d48;padding-left:.75rem}
</style></head><body><div class="card">${body}</div></body></html>`,
		{ status, headers: { "Content-Type": "text/html; charset=utf-8" } },
	);
}

function oauthError(error: string, description: string, status = 400): Response {
	return new Response(JSON.stringify({ error, error_description: description }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Handle every /oauth/* route plus RFC 8414 metadata.
 * Returns undefined when the request is not ours.
 */
export async function handleOAuth(
	req: Request,
	cfg: OAuthConfig,
): Promise<Response | undefined> {
	const url = new URL(req.url);
	const path = url.pathname;

	if (path === "/.well-known/oauth-authorization-server") {
		return Response.json(authorizationServerMetadata(cfg));
	}

	// --- Open registration -------------------------------------------------
	// DCR is deprecated in favour of Client ID Metadata Documents, but clients
	// in the field still register this way, so keep accepting it.
	if (path === "/oauth/register" && req.method === "POST") {
		const body = await req.json().catch(() => ({}) as any);
		const redirectUris: string[] = body.redirect_uris ?? [];
		if (redirectUris.length === 0) {
			return oauthError("invalid_client_metadata", "redirect_uris is required");
		}
		const clientId = `mcp_${randomBytes(16).toString("hex")}`;
		clients.set(clientId, { redirectUris, name: body.client_name });
		return Response.json(
			{
				client_id: clientId,
				redirect_uris: redirectUris,
				client_name: body.client_name,
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
			},
			{ status: 201 },
		);
	}

	// --- Authorization endpoint -------------------------------------------
	if (path === "/oauth/authorize") {
		sweep();

		// The GET carries parameters in the query string; the approval POST
		// carries them back as form fields. Reading only the query string meant
		// every approval failed validation with an empty client_id.
		const form = req.method === "POST" ? await req.formData().catch(() => null) : null;
		const param = (key: string): string =>
			(form ? String(form.get(key) ?? "") : url.searchParams.get(key)) ?? "";

		const clientId = param("client_id");
		const redirectUri = param("redirect_uri");
		const state = param("state");
		const challenge = param("code_challenge");
		const method = param("code_challenge_method");
		const resource = param("resource") || cfg.resource;
		const scope = param("scope") || SUPPORTED_SCOPES.join(" ");

		if (!clientId || !redirectUri) {
			return html(
				`<h1>Invalid request</h1><p>Missing <code>client_id</code> or <code>redirect_uri</code>.</p>`,
				400,
			);
		}
		// PKCE is mandatory under OAuth 2.1; plain is not accepted.
		if (!challenge || method !== "S256") {
			return html(
				`<h1>Invalid request</h1><p>PKCE with <code>code_challenge_method=S256</code> is required.</p>`,
				400,
			);
		}

		const known = clients.get(clientId);
		if (known && !known.redirectUris.includes(redirectUri)) {
			return html(
				`<h1>Invalid request</h1><p>That <code>redirect_uri</code> is not registered for this client.</p>`,
				400,
			);
		}

		if (req.method === "GET") {
			const needsPassword = Boolean(cfg.password);
			return html(`
				<h1>Connect to your Snoonu account</h1>
				<p>An MCP client wants to search, manage your cart, and check out on
				   your behalf, using the Snoonu session on this server.</p>
				<p class="warn"><strong>This grants the ability to place real orders
				   and spend real money.</strong> Only approve a client you started.</p>
				<form method="POST">
					${Object.entries({ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method, resource, scope })
						.map(
							([k, v]) =>
								`<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`,
						)
						.join("")}
					${needsPassword ? `<input type="password" name="password" placeholder="Server password" autofocus required>` : ""}
					<button type="submit">Approve access</button>
				</form>`);
		}

		if (req.method === "POST") {
			if (cfg.password) {
				const given = param("password");
				const a = Buffer.from(given);
				const b = Buffer.from(cfg.password);
				if (a.length !== b.length || !timingSafeEqual(a, b)) {
					return html(
						`<h1>Incorrect password</h1><p>Go back and try again.</p>`,
						401,
					);
				}
			}

			const code = randomBytes(32).toString("base64url");
			codes.set(code, {
				clientId,
				redirectUri,
				codeChallenge: challenge,
				resource,
				scope,
				expiresAt: Date.now() + CODE_TTL_MS,
			});

			const target = new URL(redirectUri);
			target.searchParams.set("code", code);
			if (state) target.searchParams.set("state", state);
			// RFC 9207 — let the client pin the issuer.
			target.searchParams.set("iss", cfg.issuer);
			return Response.redirect(target.toString(), 302);
		}
	}

	// --- Token endpoint ----------------------------------------------------
	if (path === "/oauth/token" && req.method === "POST") {
		sweep();
		const form = await req.formData().catch(() => null);
		if (!form) return oauthError("invalid_request", "expected form-encoded body");

		const grantType = String(form.get("grant_type") ?? "");
		if (grantType !== "authorization_code") {
			return oauthError(
				"unsupported_grant_type",
				`grant_type "${grantType}" is not supported`,
			);
		}

		const code = String(form.get("code") ?? "");
		const verifier = String(form.get("code_verifier") ?? "");
		const redirectUri = String(form.get("redirect_uri") ?? "");
		const pending = codes.get(code);

		if (!pending) return oauthError("invalid_grant", "unknown or expired code");
		codes.delete(code); // single use
		if (pending.expiresAt < Date.now()) {
			return oauthError("invalid_grant", "code expired");
		}
		if (pending.redirectUri !== redirectUri) {
			return oauthError("invalid_grant", "redirect_uri mismatch");
		}

		// PKCE S256
		const computed = createHash("sha256").update(verifier).digest("base64url");
		if (computed !== pending.codeChallenge) {
			return oauthError("invalid_grant", "PKCE verification failed");
		}

		// RFC 8707: the token is bound to the requested resource. A client asking
		// for a different resource than it authorised for is rejected.
		const requested = form.get("resource");
		const audience = requested ? String(requested) : pending.resource;
		if (
			requested &&
			String(requested).replace(/\/$/, "") !== pending.resource.replace(/\/$/, "")
		) {
			return oauthError("invalid_target", "resource does not match the authorization");
		}

		const now = Math.floor(Date.now() / 1000);
		const access = sign({
			sub: "snoonu-host",
			aud: audience,
			iss: cfg.issuer,
			client_id: pending.clientId,
			scope: pending.scope,
			iat: now,
			exp: now + ACCESS_TOKEN_TTL_S,
			jti: randomBytes(12).toString("hex"),
		});

		return Response.json(
			{
				access_token: access,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_TTL_S,
				scope: pending.scope,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	return undefined;
}
