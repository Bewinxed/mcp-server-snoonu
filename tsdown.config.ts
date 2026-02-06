import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mcp/server.ts"],
  format: "esm",
  target: "node18",
  platform: "node",
  external: ["@modelcontextprotocol/sdk", "zod", "playwright"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
});
