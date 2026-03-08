# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Railway deployment wrapper** for OpenClaw, a personal AI assistant for messaging platforms. It is NOT OpenClaw itself — it's a Node.js wrapper server that:

- Manages the OpenClaw gateway process (spawn, monitor, auto-restart)
- Provides a password-protected management dashboard (`/lite`) and setup wizard (`/onboard`)
- Reverse-proxies all other traffic to the internal OpenClaw gateway on `127.0.0.1:18789`
- Handles WebSocket upgrades for PTY terminals and gateway passthrough

## Commands

```bash
# Development
npm run dev              # Start with file-watch (node --watch)
npm start                # Start server (node src/server.js)

# Testing (Node.js built-in test runner, no Jest/Mocha)
npm test                 # All tests
npm run test:unit        # Channel data integrity + config builder tests
npm run test:e2e         # E2E deploy flow (spawns real server with mock CLI)

# Docker
make build               # Production Docker image
make build-local         # Local dev image with mock CLI
make run                 # Build + run with auto-generated password
make deploy-local        # docker-compose up
make test                # Build production image + curl endpoint tests
make test-local          # Build local image + curl endpoint tests
make logs                # Container logs
make shell               # Shell into running container
make clean               # Remove containers, images, volumes
```

No linter is configured. Tests use `node:test` and `node:assert/strict`.

## Architecture

```
Internet → Wrapper Server (Express 5, $PORT/8080)
             ├── /health/*          → healthRouter (no auth)
             ├── /login             → login page + cookie auth
             ├── /onboard/*   [PW] → setup wizard + API + PTY terminal
             ├── /lite/*      [PW] → management dashboard + API + PTY terminal
             ├── /api/schemas [PW] → JSON Schema + form metadata
             └── /*                → Reverse proxy → OpenClaw Gateway (127.0.0.1:18789)
```

`[PW]` = `SETUP_PASSWORD` required via Bearer token, query param, or cookie.

### Key Source Files

- **`src/server.js`** (~900 lines) — Express 5 entry point with ALL route handlers. This is the main file.
- **`src/gateway.js`** (~700 lines) — Gateway process manager. Spawns, monitors, auto-restarts the OpenClaw process. Can "adopt" an orphan gateway already on port 18789.
- **`src/gateway-rpc.js`** — One-shot WebSocket JSON-RPC client to gateway (connect handshake with token, send request, close).
- **`src/proxy.js`** — `http-proxy` reverse proxy. HTTP proxy injects auth token. WS upgrade strips all forwarded headers.
- **`src/auth.js`** — `createAuthMiddleware()` checking Bearer / query param / cookie. Exits process if `SETUP_PASSWORD` unset.
- **`src/channels.js`** — 17 channel definitions (`CHANNEL_GROUPS`) and `buildChannelConfig()` pure function.
- **`src/onboard-page.js`** / **`src/ui-page.js`** — Large self-contained HTML pages (~120KB / ~190KB) with all CSS, JS, and i18n inline. No bundler.
- **`src/schema/`** — 13 JSON Schema files in `sections/`, Ajv validation, form metadata, and legacy config migration.

### Data Flow

**Onboard:** User selects provider + channels → POST `/onboard/api/run` → server runs `openclaw onboard --non-interactive` → starts gateway → pushes channel configs via `openclaw config set --json`.

**Runtime:** External request → wrapper auth check → reverse proxy to gateway on loopback. Management APIs handled directly in `server.js`.

**State persists at `/data/`:** Config in `/data/.openclaw/openclaw.json`, gateway token in `/data/.openclaw/gateway.token`, workspace files in `/data/workspace/`.

### Testing Architecture

Three layers, all `node:test`:

1. **`channels.test.js`** — Channel data integrity (imports `channels.js` only)
2. **`config-builder.test.js`** — `buildChannelConfig()` pure function unit tests
3. **`deploy-flow.test.js`** — E2E: `server-harness.js` spawns real server with `mock/openclaw` on PATH, uses temp dir for state

## Tech Stack

- Node.js >= 24, ESM (`"type": "module"`)
- Express 5, `ws`, `http-proxy`, `node-pty`
- Ajv for JSON Schema validation
- Docker multi-stage build (Node 24 Bookworm Slim), tini as PID 1
- Playwright/Chromium pre-installed in container for browser automation

## Key Patterns

- **No bundler** — HTML pages are generated as template literal strings with everything inline.
- **Auth model** — Wrapper enforces `SETUP_PASSWORD` on management routes. Gateway has its own token auth (auto-generated, stored in persistent volume). Proxy injects gateway token on HTTP, strips headers on WS.
- **Gateway lifecycle** — `gateway.js` spawns child process, tracks with `gatewayProcess`. Can adopt orphan daemons on port 18789. Auto-restarts on crash with 5s delay. Kills gateway on SIGTERM with 10s timeout.
- **Config schema** — 13 JSON Schema files composed via `$ref` from `root.schema.json`. `migrate.js` handles legacy `agent.*` → `agents.defaults.*` + `tools.*` migration.
- **In-app upgrades** — `/data/.npm-global/bin` added to PATH before system bins. Upgraded `openclaw` binary persists across container restarts without redeployment.
- **i18n** — 5 languages (en, zh-TW, zh-CN, ja, ko) defined in `src/i18n.js`, auto-detected from browser.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SETUP_PASSWORD` | Yes | — | Auth for `/onboard` and `/lite` |
| `PORT` | No | `8080` | External port (Railway overrides) |
| `INTERNAL_GATEWAY_PORT` | No | `18789` | Internal gateway port |
| `OPENCLAW_STATE_DIR` | No | `/data/.openclaw` | Config/state directory |
| `OPENCLAW_WORKSPACE_DIR` | No | `/data/workspace` | File storage directory |
| `SEARXNG_URL` | No | — | Enables pre-bundled SearXNG skill |
