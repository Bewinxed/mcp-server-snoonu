// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Session Manager for Snoonu MCP Server
 * Persists auth cookies, deviceId, and location to disk.
 * Provides headers for direct API calls.
 */

import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
	PerUser,
	currentUserId,
	userSlug,
	DEFAULT_USER,
} from "../mcp/lib/user-context";

const SESSION_DIR = join(homedir(), ".mcp-server-snoonu");
/** Pre-multi-user location. Migrated into users/local/ on first read. */
const LEGACY_SESSION_FILE = join(SESSION_DIR, "session.json");

/**
 * Each authenticated user gets their own directory. Sessions are real
 * credentials for a real Snoonu account, so they are never shared between
 * users and the directory is created 0700 / files 0600.
 */
function userDir(userId = currentUserId()): string {
	return join(SESSION_DIR, "users", userSlug(userId));
}

function sessionFile(userId = currentUserId()): string {
	return join(userDir(userId), "session.json");
}

async function ensureDir(userId = currentUserId()): Promise<void> {
	await mkdir(userDir(userId), { recursive: true, mode: 0o700 });
}

/**
 * Move a pre-multi-user session.json into users/local/ once, so an existing
 * local install keeps working after upgrading.
 */
let migrated = false;
async function migrateLegacyLayout(): Promise<void> {
	if (migrated) return;
	migrated = true;
	if (!existsSync(LEGACY_SESSION_FILE)) return;
	const target = sessionFile(DEFAULT_USER);
	if (existsSync(target)) return;
	try {
		await mkdir(userDir(DEFAULT_USER), { recursive: true, mode: 0o700 });
		await rename(LEGACY_SESSION_FILE, target);
		console.error(
			`[session] migrated ${LEGACY_SESSION_FILE} -> ${target} for per-user isolation`,
		);
	} catch (err) {
		console.error("[session] legacy migration failed:", (err as Error).message);
	}
}

export interface SnoonuSession {
	authToken: string;
	deviceId: string;
	locationToken: string;
	location: {
		latitude: string;
		longitude: string;
		address: string;
	};
	cookies: CookieData[];
	savedAt: string;
}

export interface CookieData {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}

const DEFAULT_LOCATION = {
	latitude: "25.30015325558983",
	longitude: "51.49286493659019",
	address: "Doha, Qatar",
};

/**
 * Snoonu identifies a client by device id, so users must not share one. This
 * used to be a single module-level constant, which meant every user without a
 * stored session presented the same device to Snoonu — inviting cross-user
 * rate-limiting and fraud heuristics. One stable id per user instead.
 */
const deviceIds = new PerUser<string>(
	() => `web-${crypto.randomUUID().replace(/-/g, "")}`,
);
const defaultDeviceId = (): string => deviceIds.get();

/**
 * One cached session per user. Was a single module-level `cachedSession`,
 * which meant every HTTP caller shared one Snoonu account.
 */
const sessionCache = new PerUser<SnoonuSession | null>(() => null);

/**
 * Load session from disk. Returns null if no valid session exists.
 */
export async function loadSession(): Promise<SnoonuSession | null> {
	const userId = currentUserId();
	const cached = sessionCache.get(userId);
	if (cached) return cached;

	if (userId === DEFAULT_USER) await migrateLegacyLayout();

	try {
		const raw = JSON.parse(await readFile(sessionFile(userId), "utf-8"));

		// Validate minimum required fields
		if (!raw.authToken && !raw.deviceId) {
			// Try to extract from old format (cookies array + localStorage)
			const session = migrateOldSession(raw);
			if (session) {
				sessionCache.set(session, userId);
				return session;
			}
			return null;
		}

		const session = raw as SnoonuSession;

		// If location is default but we have a locationToken, parse real coordinates
		if (
			session.locationToken &&
			session?.location?.latitude === DEFAULT_LOCATION.latitude &&
			session?.location?.longitude === DEFAULT_LOCATION.longitude
		) {
			const parsed = parseLocationToken(session.locationToken);
			if (parsed) session.location = parsed;
		}

		sessionCache.set(session, userId);
		return session;
	} catch {
		return null;
	}
}

/**
 * Migrate from old session format (Playwright cookies + localStorage)
 * to the new format used by this MCP server.
 */
function migrateOldSession(raw: any): SnoonuSession | null {
	try {
		const cookies: CookieData[] = raw.cookies || [];
		const localStorage: Record<string, string> = raw.localStorage || {};

		const authCookie = cookies.find(
			(c: CookieData) => c.name === "authToken" && c.value
		);
		if (!authCookie) return null;

		const locationCookie = cookies.find(
			(c: CookieData) => c.name === "locationToken"
		);

		// deviceId in old format could be under different keys
		let deviceId =
			localStorage.deviceId ||
			localStorage["snoonu-app-device-id"] ||
			defaultDeviceId();

		// Old format sometimes wraps in JSON quotes
		if (deviceId.startsWith('"')) {
			try {
				deviceId = JSON.parse(deviceId);
			} catch {}
		}

		// Parse real location from cookie
		const parsedLocation = locationCookie?.value
			? parseLocationToken(locationCookie.value)
			: null;

		return {
			authToken: authCookie.value,
			deviceId,
			locationToken: locationCookie?.value || "",
			location: parsedLocation || DEFAULT_LOCATION,
			cookies,
			savedAt: new Date().toISOString(),
		};
	} catch {
		return null;
	}
}

/**
 * Save session to disk.
 */
export async function saveSession(session: SnoonuSession): Promise<void> {
	const userId = currentUserId();
	session.savedAt = new Date().toISOString();
	sessionCache.set(session, userId);
	await ensureDir(userId);
	await writeFile(sessionFile(userId), JSON.stringify(session, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
}

/**
 * Clear the current user's saved session. Removes the file rather than
 * blanking it, so no residue of one user's credentials is left on disk.
 */
export async function clearSession(): Promise<void> {
	const userId = currentUserId();
	sessionCache.delete(userId);
	try {
		await rm(sessionFile(userId), { force: true });
	} catch {}
}

/**
 * Parse the locationToken cookie value to extract coordinates.
 * The cookie is URL-encoded JSON: {"name":"...","coordinates":{"lat":25.3,"lng":51.5}}
 */
function parseLocationToken(
	locationTokenValue: string
): { latitude: string; longitude: string; address: string } | null {
	try {
		const decoded = JSON.parse(decodeURIComponent(locationTokenValue));
		if (decoded?.coordinates?.lat && decoded?.coordinates?.lng) {
			return {
				latitude: String(decoded.coordinates.lat),
				longitude: String(decoded.coordinates.lng),
				address: decoded.name || "Qatar",
			};
		}
	} catch {}
	return null;
}

/**
 * Update session from browser cookies after login.
 * Extracts authToken, deviceId, locationToken from cookie array.
 */
export async function updateSessionFromBrowser(
	cookies: CookieData[],
	deviceId?: string,
	location?: { latitude: string; longitude: string; address: string }
): Promise<SnoonuSession> {
	const authCookie = cookies.find((c) => c.name === "authToken");
	const locationCookie = cookies.find((c) => c.name === "locationToken");

	// Parse real location from cookie if not explicitly provided
	const parsedLocation = locationCookie?.value
		? parseLocationToken(locationCookie.value)
		: null;

	const session: SnoonuSession = {
		authToken: authCookie?.value || "",
		deviceId: deviceId || sessionCache.get()?.deviceId || defaultDeviceId(),
		locationToken: locationCookie?.value || "",
		location:
			location || parsedLocation || sessionCache.get()?.location || DEFAULT_LOCATION,
		cookies,
		savedAt: new Date().toISOString(),
	};

	await saveSession(session);
	return session;
}

/**
 * Check if current session has a valid auth token.
 */
export function isAuthenticated(): boolean {
	return !!sessionCache.get()?.authToken;
}

/**
 * Get current session (may be null).
 */
export function getSession(): SnoonuSession | null {
	return sessionCache.get();
}

/**
 * Headers a real snoonu.com tab sends that a bare fetch() does not.
 *
 * Snoonu started answering 403 (bare nginx page, no challenge) to a hosted
 * deployment while the identical call succeeded from a residential
 * connection. A bare 403 usually means an IP/ASN deny rule rather than bot
 * detection, but the request was also trivially non-browser: fetch() sends
 * its own runtime User-Agent and no Origin or Referer at all. This closes
 * that gap so the difference is only the source address.
 *
 * Diagnostically this is also the cheap version of the "use a real browser"
 * experiment: driving Chromium would not change the source IP, so if a
 * byte-identical browser header set still gets 403, neither would Playwright.
 */
export const BROWSER_HEADERS: Record<string, string> = {
	"user-agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
	"accept-language": "en-US,en;q=0.9",
	origin: "https://snoonu.com",
	referer: "https://snoonu.com/",
	"sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
	"sec-ch-ua-mobile": "?0",
	"sec-ch-ua-platform": '"Windows"',
	"sec-fetch-dest": "empty",
	"sec-fetch-mode": "cors",
	"sec-fetch-site": "same-site",
};

/**
 * Generate headers required for Snoonu API calls.
 */
export function getApiHeaders(session?: SnoonuSession | null): Record<string, string> {
	const s = session || sessionCache.get();

	const latitude = s?.location?.latitude || DEFAULT_LOCATION.latitude;
	const longitude = s?.location?.longitude || DEFAULT_LOCATION.longitude;
	const deviceId = s?.deviceId || defaultDeviceId();

	if (!latitude) console.error("[session] WARNING: latitude resolved to empty string — API calls will return empty results");
	if (!longitude) console.error("[session] WARNING: longitude resolved to empty string — API calls will return empty results");
	if (!deviceId) console.error("[session] WARNING: device id resolved to empty string — API calls will return empty results");

	return {
		...BROWSER_HEADERS,
		accept: "*/*",
		"content-type": "application/json",
		appversion: "2",
		language: "en",
		latitude,
		longitude,
		"snoonu-app-device-id": deviceId,
		"snoonu-app-platform": "Web",
		"snoonu-app-version": "65535.65535.65535.65535",
		token: s?.authToken || "",
	};
}

/**
 * Get the session file path (for external tools that need it).
 */
export function getSessionPath(): string {
	return sessionFile();
}
