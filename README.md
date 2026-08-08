# mcp-server-snoonu

[![npm version](https://img.shields.io/npm/v/mcp-server-snoonu.svg)](https://www.npmjs.com/package/mcp-server-snoonu)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/Bewinxed/mcp-server-snoonu/blob/main/LICENSE)

> [!IMPORTANT]
> **Your credentials never leave your machine.** All authentication (OTP login, session cookies) is handled locally via a browser on your device. Session data is stored at `~/.mcp-server-snoonu/session.json` on your filesystem only — no tokens or passwords are ever sent to or stored on any remote server.

A Model Context Protocol (MCP) server for shopping on [Snoonu](https://snoonu.com) — Qatar's delivery platform. Search products, manage your cart, and checkout — all from any MCP-compatible agent.

## Quick Start

```bash
npx mcp-server-snoonu
```

### Claude Code

```bash
claude mcp add snoonu -- npx -y mcp-server-snoonu
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "snoonu": {
      "command": "npx",
      "args": ["-y", "mcp-server-snoonu"]
    }
  }
}
```

## Tools

| Tool                   | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `init_session`         | Initialize or restore a saved auth session                     |
| `login`                | Start OTP login flow with phone number                         |
| `verify_otp`           | Complete login with the 6-digit OTP code                       |
| `logout`               | Clear the current session                                      |
| `search_products`      | Search across merchants (supports `deep_search` for full catalogs) |
| `bulk_search`          | Search multiple products at once in parallel (great for grocery lists) |
| `search_in_merchant`   | Search within a specific merchant by menu ID                   |
| `get_product_details`  | Get images, descriptions, and stock info for a product         |
| `browse_categories`    | List top-level categories (Groceries, Restaurants, etc.)       |
| `get_saved_addresses`  | List saved delivery addresses                                  |
| `set_delivery_location`| Switch delivery location by address ID                         |
| `add_to_cart`          | Add items to cart (requires login)                             |
| `get_cart`             | View current cart contents                                     |
| `remove_from_cart`     | Remove items from cart                                         |
| `clear_cart`           | Empty the entire cart                                          |
| `go_to_checkout`       | Navigate to checkout                                           |
| `get_payment_methods`  | List payment methods on the checkout page                      |
| `select_payment_method`| Choose a payment method by index                               |
| `place_order`          | **Submits the order and charges real money**                   |

Every tool carries MCP [tool annotations](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
so clients can gate them. `place_order` is marked `destructiveHint: true`; all
search/browse/read tools are `readOnlyHint: true`. Tools also declare an
`outputSchema` and return `structuredContent`, so clients get typed results
rather than JSON embedded in a text block.

You do **not** need to call `init_session` first — authentication resolves
lazily from the saved session on any tool that needs it. `init_session` remains
available as a diagnostic.

## Requirements

- Node.js **20+** (or Bun 1.x)
- Chromium via Playwright for the login and checkout flows: `npx playwright install chromium`

## Protocol support

Speaks MCP **2026-07-28** (via `@modelcontextprotocol/server` v2) and falls back
automatically to the 2025-era `initialize` handshake for older clients, so both
generations of client work against the same binary.

Because 2026-07-28 removes protocol sessions, this server keeps no per-connection
state. Product metadata and cart contents live in a persistent store:

| Backend | When | Location |
| ------- | ---- | -------- |
| Disk (default) | `npx` / stdio / local | `~/.mcp-server-snoonu/store.json` (mode 0600) |
| Redis (opt-in) | Docker / multi-replica HTTP | set `REDIS_URL` (requires Bun) |

This is what makes a product id from one session still resolvable in the next —
Snoonu has no fetch-product-by-id endpoint, so results must be remembered.

## Remote / HTTP deployment

The HTTP entry point can place real orders using the host's Snoonu session, so it
refuses to start unencrypted-and-open:

| Variable | Purpose |
| -------- | ------- |
| `MCP_AUTH_TOKEN` | **Required.** Clients must send `Authorization: Bearer <token>` |
| `ALLOW_ANONYMOUS=1` | Explicit opt-out of the above. Only for a genuinely private port |
| `MCP_ALLOWED_HOSTS` | Comma-separated hostnames accepted in `Host` (default: localhost only) |
| `MCP_ALLOWED_ORIGINS` | Comma-separated origin hostnames for CORS (default: localhost only) |
| `HOST` / `PORT` | Bind address (default `127.0.0.1`) and port (default `3000`) |
| `REDIS_URL` | Share cart/product state across replicas |

Host and Origin headers are validated on every request (DNS-rebinding
protection, as the spec requires).

```bash
docker run -p 3000:3000 -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) mcp-server-snoonu
```

## Architecture

```text
src/
├── mcp/
│   ├── server.ts          # Stdio entry point (local use via npx/bunx)
│   ├── server-http.ts     # HTTP entry point (remote/Docker deployment)
│   ├── create-server.ts   # Shared server factory (per-connection, stateless)
│   ├── lib/
│   │   ├── result.ts      # ok()/fail() helpers — fail() sets isError at the protocol level
│   │   ├── store.ts       # Persistent product/cart store (disk or Redis)
│   │   ├── cart-state.ts  # Bridges api-client's in-memory cart with the store
│   │   └── auth.ts        # Lazy session loading
│   └── tools/             # Tool definitions (Zod schemas + handlers)
│       ├── session.ts     # init_session, login, verify_otp, logout
│       ├── search.ts      # search_products, bulk_search, search_in_merchant, get_product_details
│       ├── cart.ts        # add_to_cart, get_cart, remove_from_cart, clear_cart
│       ├── checkout.ts    # go_to_checkout, get_payment_methods, select_payment_method, place_order
│       ├── browse.ts      # browse_categories
│       └── location.ts    # get_saved_addresses, set_delivery_location
├── lib/
│   ├── api-client.ts      # Direct fetch() client for Snoonu APIs
│   ├── session-manager.ts # Cookie/token persistence (~/.mcp-server-snoonu/)
│   └── browser.ts         # Playwright browser for login/checkout flows
└── types/
    └── snoonu/            # TypeScript types for Snoonu API responses
```

## Development

```bash
# Clone
git clone https://github.com/Bewinxed/mcp-server-snoonu.git
cd mcp-server-snoonu

# Install
bun install

# Run directly with Bun (no build step)
bun run dev

# Typecheck and test (tests drive the real server over stdio)
bun run typecheck
bun test

# Skip tests that hit the live Snoonu API
SNOONU_OFFLINE=1 bun test

# Build for npm
bun run build
```

## License

[AGPL-3.0](LICENSE) — Copyright (c) 2025 Omar Al Matar

> [!NOTE]
> **Disclaimer:** This project is not affiliated with, endorsed by, or sponsored by Snoonu or any of its subsidiaries. "Snoonu" is a trademark of Snoonu W.L.L. This is an independent, open-source tool that interacts with publicly available Snoonu web APIs. Use at your own risk and in accordance with Snoonu's terms of service.
