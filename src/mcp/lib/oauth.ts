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
 * assumes you already run an AS, so this module is a small one covering exactly
 * the flow MCP clients use:
 *
 *   authorization code + PKCE (S256 required), RFC 8707 resource binding,
 *   RFC 8414 AS metadata, and open registration for public clients.
 *
 * IDENTITY
 * --------
 * The resource being protected IS a Snoonu account, so the Snoonu login is the
 * authentication: phone number → SMS OTP. No invented password, and no shared
 * account — each person signs in as themselves, the token's `sub` is derived
 * from their number, and every downstream call runs scoped to that user with
 * their own session, cart, and browser context.
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { runAsUser } from "./user-context";
import { requestOtp, verifyOtp } from "../../lib/browser";
import { fetchIdentity } from "../../lib/api-client";
import { saveSession } from "../../lib/session-manager";

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
			"        reject each other's tokens.\n" +
			"        It also seeds the per-user id derived from a phone number, so\n" +
			"        restarting orphans every user's saved Snoonu session and they\n" +
			"        must sign in again. Set it:\n" +
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
	/** The Snoonu account this code (and the resulting token) acts on. */
	userId: string;
	expiresAt: number;
}

const codes = new Map<string, PendingCode>();
const clients = new Map<string, { redirectUris: string[]; name?: string }>();

// ---------------------------------------------------------------------------
// Authentication: the user's own Snoonu login
// ---------------------------------------------------------------------------

/**
 * OAuth requires the Authorization Server to authenticate the resource owner
 * before issuing a code — otherwise /oauth/authorize hands tokens to anyone who
 * finds the URL. Normally that step is "log in with Google".
 *
 * Here the resource IS a Snoonu account, so the authentication is the Snoonu
 * login itself: phone number → SMS OTP. That is strictly better than a
 * server-wide password, because it both proves identity AND establishes *which*
 * account this token may act on. Every user authenticates as themselves and
 * gets their own isolated session — no shared account, no invented secret.
 *
 * The OAuth `sub` is derived from the phone number, so the same person
 * reconnecting resumes their own session.
 */
const LOGIN_TTL_MS = 10 * 60 * 1000;

interface PendingLogin {
	phone: string;
	/** Carried through the OTP step so the redirect can be completed after. */
	params: Record<string, string>;
	/**
	 * The in-flight OTP request. Deliberately NOT awaited before responding.
	 *
	 * Requesting the code can take up to ~106s of Playwright timeouts (Chromium
	 * launch, hydration wait, the location-modal retry loop, waiting for the PIN
	 * screen). Blocking the HTTP response on that blew straight through
	 * Coolify/Traefik's ~60s proxy timeout and the user got a 502 right after
	 * entering their number.
	 *
	 * Snoonu sends the SMS regardless of whether our response is still open, so
	 * the request is started, the OTP form is rendered immediately, and this
	 * promise is awaited later — by which time it has usually settled.
	 */
	otpRequest: Promise<{ success: boolean; message: string }>;
	expiresAt: number;
}

/** Resolve a promise or give up after `ms`, without leaving it unhandled. */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(onTimeout), ms);
		timer.unref?.();
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(err) => {
				clearTimeout(timer);
				resolve({
					...(onTimeout as any),
					message: err instanceof Error ? err.message : String(err),
				});
			},
		);
	});
}

const logins = new Map<string, PendingLogin>();

/** Stable, non-reversible user id for a phone number. */
export function userIdForPhone(phone: string): string {
	const digits = phone.replace(/\D/g, "");
	return `snoonu_${createHash("sha256")
		.update(`${digits}:${SIGNING_KEY}`)
		.digest("hex")
		.slice(0, 24)}`;
}

function sweep(): void {
	const now = Date.now();
	for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);
	for (const [k, v] of logins) if (v.expiresAt < now) logins.delete(k);
}

/**
 * Mint an authorization code for an already-authenticated user.
 *
 * Split out of the authorize handler so the token exchange can be tested
 * without driving a real SMS OTP. This is not a bypass: it takes an already
 * proven userId, and nothing routes to it except the post-OTP path and tests.
 */
export function issueAuthorizationCode(params: {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string;
	scope: string;
	userId: string;
}): string {
	const code = randomBytes(32).toString("base64url");
	codes.set(code, { ...params, expiresAt: Date.now() + CODE_TTL_MS });
	return code;
}

export interface OAuthConfig {
	issuer: string;
	resource: string;
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

/** Escape untrusted text before putting it in the approval pages. */
function escapeHtml(v: string): string {
	return v
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
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

		const carried = {
			client_id: clientId,
			redirect_uri: redirectUri,
			state,
			code_challenge: challenge,
			code_challenge_method: method,
			resource,
			scope,
		};
		const hidden = (extra: Record<string, string> = {}) =>
			Object.entries({ ...carried, ...extra })
				.map(
					([k, v]) =>
						`<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`,
				)
				.join("");

		// Step 1 — offer both sign-in methods.
		if (req.method === "GET") {
			return html(`
				<h1>Sign in to Snoonu</h1>
				<p>An MCP client wants to search, manage your cart, and check out on
				   your behalf. Sign in with your own Snoonu account — you get your
				   own private session and cart.</p>
				<p class="warn"><strong>This grants the ability to place real orders
				   and spend real money.</strong> Only continue if you started this.</p>

				<form method="POST">
					${hidden({ step: "phone" })}
					<input name="phone" inputmode="tel" autocomplete="tel"
					       placeholder="Phone number (e.g. 55123456)" autofocus required>
					<button type="submit">Send code</button>
				</form>
				<p style="font-size:.8rem">The code can take up to a minute — the server
				   signs in to Snoonu on your behalf.</p>

				<details style="margin-top:1.75rem">
					<summary style="cursor:pointer;color:#a1a1aa;font-size:.85rem">
						SMS not arriving? Paste a session instead
					</summary>
					<p style="font-size:.85rem">Snoonu guards login with reCAPTCHA
					   (<code>use_google_re_captcha: true</code>). It normally passes, but
					   if your server's IP is scored badly the code is dropped silently.
					   Signing in from your own browser sidesteps it.</p>
					<ol style="color:#a1a1aa;font-size:.85rem;line-height:1.6;padding-left:1.1rem">
						<li>Open <a href="https://snoonu.com" target="_blank" rel="noopener">snoonu.com</a> and log in as normal.</li>
						<li>Open DevTools (F12) → Console, paste this, press Enter:</li>
					</ol>
					<pre style="background:#0b0b0c;border:1px solid #34343a;border-radius:8px;padding:.6rem;font-size:.72rem;overflow-x:auto;color:#d4d4d8">copy(JSON.stringify({token:document.cookie.match(/authToken=([^;]+)/)?.[1],deviceId:(localStorage.getItem('deviceId')||'').replace(/"/g,'')}))</pre>
					<form method="POST">
						${hidden({ step: "token" })}
						<input name="session" placeholder='{"token":"...","deviceId":"..."}' required>
						<button type="submit" style="background:#3f3f46">Connect with session</button>
					</form>
				</details>`);
		}

		if (req.method === "POST") {
			const step = param("step");

			// Paste-your-session path — a fallback, not the default.
			//
			// SMS login does work from a datacenter host (confirmed in production
			// once the request stopped being killed by the proxy timeout). Snoonu
			// does gate OTP behind reCAPTCHA, so a badly-scored IP can still drop
			// the code silently; this path exists for that case, because the
			// credential is minted in the user's own browser instead.
			if (step === "token") {
				let authToken = "";
				let deviceId = "";
				try {
					const parsed = JSON.parse(param("session").trim());
					authToken = String(parsed.token ?? parsed.authToken ?? "").trim();
					deviceId = String(parsed.deviceId ?? parsed.device_id ?? "").trim();
				} catch {
					return html(
						`<h1>Couldn't read that</h1><p>Paste the whole JSON snippet the console copied, including the braces.</p>`,
						400,
					);
				}
				if (!authToken || !deviceId) {
					return html(
						`<h1>Missing token or deviceId</h1><p>Make sure you are logged in to snoonu.com before running the snippet.</p>`,
						400,
					);
				}

				const identity = await fetchIdentity(authToken, deviceId).catch(() => null);
				if (!identity) {
					return html(
						`<h1>That session isn't valid</h1>
						 <p>Snoonu rejected it. Log in to snoonu.com again and re-copy the snippet — tokens expire.</p>`,
						401,
					);
				}

				const uid = userIdForPhone(identity.phone);
				await runAsUser(uid, () =>
					saveSession({
						authToken,
						deviceId,
						locationToken: "",
						location: {
							latitude: "25.285564",
							longitude: "51.531445",
							address: "Doha, Qatar",
						},
						cookies: [],
						savedAt: new Date().toISOString(),
					}),
				);
				console.error(
					`[oauth] session accepted for ...${identity.phone.slice(-3)} (${uid})`,
				);

				const code = issueAuthorizationCode({
					clientId,
					redirectUri,
					codeChallenge: challenge,
					resource,
					scope,
					userId: uid,
				});
				const target = new URL(redirectUri);
				target.searchParams.set("code", code);
				if (state) target.searchParams.set("state", state);
				target.searchParams.set("iss", cfg.issuer);
				return Response.redirect(target.toString(), 302);
			}

			// Step 2 — trigger the Snoonu OTP for that number.
			if (step === "phone") {
				const phone = param("phone").trim();
				if (!/^\d{6,15}$/.test(phone.replace(/\D/g, ""))) {
					return html(
						`<h1>Invalid number</h1><p>Enter a Qatar mobile number without the country code, e.g. <code>55123456</code>.</p>`,
						400,
					);
				}

				const userId = userIdForPhone(phone);
				// Start the login inside that user's own context so the OTP and
				// resulting cookies land in their session, not a shared one.
				// NOT awaited — see the note on PendingLogin.otpRequest.
				const startedAt = Date.now();
				const otpRequest = runAsUser(userId, () => requestOtp(phone))
					.catch((err: unknown) => ({
						success: false,
						message: err instanceof Error ? err.message : String(err),
					}))
					.then((r) => {
						// Log the OUTCOME. The form is rendered before this settles,
						// so without this line a failure at second 30 is completely
						// silent: the user is told "code sent" and simply never
						// receives one, with nothing in the logs to explain it.
						const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
						console.error(
							r.success
								? `[oauth] OTP requested for ...${phone.slice(-3)} in ${secs}s`
								: `[oauth] OTP request FAILED for ...${phone.slice(-3)} after ${secs}s: ${r.message}`,
						);
						return r;
					});

				const loginId = randomBytes(24).toString("base64url");
				logins.set(loginId, {
					phone,
					params: carried,
					otpRequest,
					expiresAt: Date.now() + LOGIN_TTL_MS,
				});

				// Give it a moment to fail fast on obvious errors (no Chromium,
				// no network) so the user sees a real message instead of typing a
				// code that will never arrive. Otherwise fall through and let
				// them wait for the SMS.
				const early = await withTimeout(otpRequest, 8000, {
					success: true,
					message: "",
				});
				if (!early.success) {
					logins.delete(loginId);
					return html(
						`<h1>Could not send the code</h1><p>${escapeHtml(early.message)}</p>
						 <p><a href="${escapeHtml(url.pathname + url.search)}">Try again</a></p>`,
						502,
					);
				}

				return html(`
					<h1>Enter your code</h1>
					<p>Sending a 6-digit code to <strong>${escapeHtml(phone)}</strong>.
					   It can take up to a minute to arrive.</p>
					<p>If nothing arrives, the server could not complete the Snoonu
					   login — check the server logs for <code>[oauth] OTP request
					   FAILED</code>.</p>
					<form method="POST">
						${hidden({ step: "otp", login_id: loginId })}
						<input name="otp" inputmode="numeric" autocomplete="one-time-code"
						       placeholder="6-digit code" autofocus required>
						<button type="submit">Verify and connect</button>
					</form>`);
			}

			// Step 3 — verify the OTP, then issue the authorization code.
			if (step === "otp") {
				const loginId = param("login_id");
				const pending = logins.get(loginId);
				if (!pending || pending.expiresAt < Date.now()) {
					logins.delete(loginId);
					return html(
						`<h1>Session expired</h1><p>Start the connection again from your MCP client.</p>`,
						400,
					);
				}

				const otp = param("otp").trim();
				const userId = userIdForPhone(pending.phone);

				// The OTP request may still be in flight (we returned this form
				// early on purpose). Verifying before the PIN screen exists would
				// fail spuriously, so wait for it to settle first.
				const requested = await withTimeout(pending.otpRequest, 60_000, {
					success: false,
					message: "Timed out while requesting the code. Start again.",
				});
				if (!requested.success) {
					logins.delete(loginId);
					return html(
						`<h1>Could not send the code</h1><p>${escapeHtml(requested.message)}</p>`,
						502,
					);
				}

				const verified = await runAsUser(userId, () => verifyOtp(otp));

				if (!verified.loggedIn) {
					return html(`
						<h1>That code didn't work</h1>
						<p>${escapeHtml(verified.message)}</p>
						<form method="POST">
							${hidden({ step: "otp", login_id: loginId })}
							<input name="otp" inputmode="numeric" placeholder="6-digit code" autofocus required>
							<button type="submit">Try again</button>
						</form>`);
				}

				logins.delete(loginId);

				// Binds the token — and therefore every downstream session,
				// cart, and browser context — to THIS Snoonu account.
				const code = issueAuthorizationCode({
					clientId,
					redirectUri,
					codeChallenge: challenge,
					resource,
					scope,
					userId,
				});

				const target = new URL(redirectUri);
				target.searchParams.set("code", code);
				if (state) target.searchParams.set("state", state);
				// RFC 9207 — let the client pin the issuer.
				target.searchParams.set("iss", cfg.issuer);
				return Response.redirect(target.toString(), 302);
			}

			return html(`<h1>Unexpected step</h1><p>Start again from your MCP client.</p>`, 400);
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
			sub: pending.userId,
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
