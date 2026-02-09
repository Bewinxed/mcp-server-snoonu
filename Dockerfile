FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Install Playwright Chromium for browser-based tools (login, checkout)
RUN bunx playwright install --with-deps chromium

EXPOSE 3000
ENV PORT=3000

CMD ["bun", "run", "src/mcp/server-http.ts"]
