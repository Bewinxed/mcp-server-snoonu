/**
 * Session Manager for Snoonu MCP Server
 * Persists auth cookies, deviceId, and location to disk.
 * Provides headers for direct API calls.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const SESSION_DIR = join(homedir(), ".mcp-server-snoonu");
const SESSION_FILE = join(SESSION_DIR, "session.json");

async function ensureDir(): Promise<void> {
	await mkdir(SESSION_DIR, { recursive: true });
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

const DEFAULT_DEVICE_ID = `web-${crypto.randomUUID().replace(/-/g, "")}`;

let cachedSession: SnoonuSession | null = null;

/**
 * Load session from disk. Returns null if no valid session exists.
 */
export async function loadSession(): Promise<SnoonuSession | null> {
	if (cachedSession) return cachedSession;

	try {
		const raw = JSON.parse(await readFile(SESSION_FILE, "utf-8"));

		// Validate minimum required fields
		if (!raw.authToken && !raw.deviceId) {
			// Try to extract from old format (cookies array + localStorage)
			const session = migrateOldSession(raw);
			if (session) {
				cachedSession = session;
				return session;
			}
			return null;
		}

		cachedSession = raw as SnoonuSession;

		// If location is default but we have a locationToken, parse real coordinates
		if (
			cachedSession.locationToken &&
			cachedSession.location.latitude === DEFAULT_LOCATION.latitude &&
			cachedSession.location.longitude === DEFAULT_LOCATION.longitude
		) {
			const parsed = parseLocationToken(cachedSession.locationToken);
			if (parsed) cachedSession.location = parsed;
		}

		return cachedSession;
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
			DEFAULT_DEVICE_ID;

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
	session.savedAt = new Date().toISOString();
	cachedSession = session;
	await ensureDir();
	await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Clear saved session.
 */
export async function clearSession(): Promise<void> {
	cachedSession = null;
	try {
		await ensureDir();
		await writeFile(SESSION_FILE, "{}", "utf-8");
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
		deviceId: deviceId || cachedSession?.deviceId || DEFAULT_DEVICE_ID,
		locationToken: locationCookie?.value || "",
		location: location || parsedLocation || cachedSession?.location || DEFAULT_LOCATION,
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
	return !!cachedSession?.authToken;
}

/**
 * Get current session (may be null).
 */
export function getSession(): SnoonuSession | null {
	return cachedSession;
}

/**
 * Generate headers required for Snoonu API calls.
 */
export function getApiHeaders(session?: SnoonuSession | null): Record<string, string> {
	const s = session || cachedSession;

	return {
		accept: "*/*",
		"content-type": "application/json",
		appversion: "2",
		language: "en",
		latitude: s?.location.latitude || DEFAULT_LOCATION.latitude,
		longitude: s?.location.longitude || DEFAULT_LOCATION.longitude,
		"snoonu-app-device-id": s?.deviceId || DEFAULT_DEVICE_ID,
		"snoonu-app-platform": "Web",
		"snoonu-app-version": "65535.65535.65535.65535",
		token: s?.authToken || "",
	};
}

/**
 * Get the session file path (for external tools that need it).
 */
export function getSessionPath(): string {
	return SESSION_FILE;
}
