import { defineConfig } from "tsdown";

export default defineConfig({
	// Only the stdio server is published as a bin — it runs under plain Node.
	// The HTTP server uses Bun.serve and is deployed via Docker/`bun run`.
	entry: ["src/mcp/server.ts", "src/mcp/server-http.ts"],
	format: "esm",
	target: "node20",
	platform: "node",
	external: [
		"@modelcontextprotocol/server",
		"zod",
		"playwright",
		"playwright-extra",
		"puppeteer-extra-plugin-stealth",
	],
	banner: { js: "#!/usr/bin/env node" },
	clean: true,
});
