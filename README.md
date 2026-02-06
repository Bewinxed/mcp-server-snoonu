# mcp-server-snoonu

[![npm version](https://img.shields.io/npm/v/mcp-server-snoonu.svg)](https://www.npmjs.com/package/mcp-server-snoonu)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/Bewinxed/mcp-server-snoonu/blob/main/LICENSE)

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
| `search_in_merchant`   | Search within a specific merchant by menu ID                   |
| `get_product_details`  | Get images, descriptions, and stock info for a product         |
| `browse_categories`    | List top-level categories (Groceries, Food, etc.)              |
| `get_saved_addresses`  | List saved delivery addresses                                  |
| `set_delivery_location`| Switch delivery location by address ID                         |
| `add_to_cart`          | Add items to cart (requires login)                             |
| `get_cart`             | View current cart contents                                     |
| `remove_from_cart`     | Remove items from cart                                         |
| `clear_cart`           | Empty the entire cart                                          |
| `go_to_checkout`       | Navigate to checkout                                           |

## Architecture

```text
src/
├── mcp/
│   ├── server.ts          # MCP server entry point (stdio)
│   └── tools/             # Tool definitions (Zod schemas + handlers)
│       ├── session.ts     # init_session, login, verify_otp, logout
│       ├── search.ts      # search_products, search_in_merchant
│       ├── cart.ts        # add_to_cart, get_cart, remove_from_cart, clear_cart
│       ├── checkout.ts    # go_to_checkout
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

# Build for npm
bun run build
```

## License

[MIT](LICENSE)
