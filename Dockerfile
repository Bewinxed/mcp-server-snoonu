FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Copy source (see .dockerignore — session/credential files are excluded)
COPY . .

# Install Playwright Chromium for browser-based tools (login, checkout)
RUN bunx playwright install --with-deps chromium

EXPOSE 3000
ENV PORT=3000
# Bind to all interfaces inside the container; the host controls exposure.
ENV HOST=0.0.0.0

# This endpoint can place real orders with the host's Snoonu session.
# The server refuses to start unless MCP_AUTH_TOKEN is set (or ALLOW_ANONYMOUS=1).
#   docker run -e MCP_AUTH_TOKEN=... -e MCP_ALLOWED_HOSTS=your.host ...
# Set REDIS_URL to share cart/product state across replicas.

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/mcp/server-http.ts"]
