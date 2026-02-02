# Snoonu Shopping Agent

AI-powered shopping agent for Snoonu using the Claude Agent SDK.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  SvelteKit UI   │ ←→  │  Agent SDK Server    │ ←→  │  Snoonu APIs    │
│  (Chat + SSE)   │     │  (Custom MCP Tools)  │     │  + Browser      │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `tools.ts` | Agent SDK MCP server with Snoonu shopping tools |
| `runner.ts` | Agent execution + event streaming |
| `events.ts` | Event emitter for SSE |
| `server.ts` | HTTP server for agent API |
| `index.ts` | Module exports |

## MCP Tools

| Tool | Description |
|------|-------------|
| `init_session` | Initialize browser session |
| `request_otp` | Start login by sending OTP to phone |
| `verify_otp` | Complete login with OTP code |
| `search_products` | Search products across merchants |
| `add_to_cart` | Add products to cart |
| `get_cart` | Get current cart contents |
| `checkout` | Navigate to checkout page |

## Usage

### Start Agent Server

```bash
bun run agent:server
```

This starts the HTTP server on port 3001.

### API Endpoints

- `POST /api/agent` - Start new agent task
  - Body: `{ "prompt": "Find the cheapest milk" }`
  - Returns: `{ "success": true, "taskId": "..." }`

- `GET /api/agent` - List all tasks

- `GET /api/agent/status?taskId=xxx` - Get task status

- `GET /api/agent/stream?taskId=xxx` - SSE stream for task events

### Test Agent Directly

```bash
bun run src/agent/test-runner.ts "Buy milk and eggs"
```

## Prerequisites

Before running the agent:

1. **Start Chrome with Remote Debugging**
   ```bash
   google-chrome --remote-debugging-port=9111
   ```

2. **Navigate to Snoonu** and log in manually (or let the agent handle it)

3. **Set Environment Variables**
   ```bash
   export ANTHROPIC_API_KEY=your_key
   export SNOONU_PHONE=your_phone_number  # optional
   ```

## Event Types

The SSE stream emits these event types:

- `session_start` - Agent session started
- `session_end` - Agent session ended
- `message` - Assistant or user message
- `tool_start` - Tool execution started
- `tool_end` - Tool execution completed
- `tool_error` - Tool execution failed
- `thinking` - Extended thinking content
- `result` - Final result
- `error` - Error occurred
