// Copyright (C) 2025 Omar Al Matar — SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single source of truth for the server version reported over MCP.
 *
 * This previously drifted: package.json said 0.2.5 while the server advertised
 * "0.1.0" to every client. Keep this in sync with package.json on release.
 */
export const version = "0.3.0";
