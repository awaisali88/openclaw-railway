# OpenClaw Railway Template — Full-Stack Edition

> Full-stack OpenClaw deployment for Railway.
> Based on [protemplate/openclaw-railway](https://github.com/protemplate/openclaw-railway),
> extended with developer AI CLIs, Google Workspace, dual-mode headless browser
> automation, and complete MCP server wiring.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/PLACEHOLDER)

---

## What's Included

### AI CLI Tools (installed to persistent volume — survive redeploys)

| Tool | Package | Required Env Var |
|------|---------|-----------------|
| Claude Code | `@anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` |
| OpenAI Codex | `@openai/codex` | `OPENAI_API_KEY` |
| Gemini CLI | `@google/gemini-cli` | `GEMINI_API_KEY` |
| gmlis (Gmail CLI) | Go binary | — |

### Dual-Mode Headless Browser Automation

Two Playwright MCP instances run simultaneously. OpenClaw picks the right
one automatically based on what you ask, or you can direct it explicitly.

| Mode | MCP Server Name | Speed | Returns | Use When |
|------|----------------|-------|---------|----------|
| Fast | `playwright` | Fast | Text / accessibility tree | Testing, scraping, form checking |
| Vision | `playwright-vision` | Slower | Actual screenshots | "show me", "screenshot", "what does X look like" |

Both run **fully headless on the Railway server**. Screenshots are sent
directly to your Telegram or Discord as image messages.

**Example commands:**
```
"Take a screenshot of github.com/openclaw and send it to me"
-> Uses playwright-vision -> screenshot arrives in your chat

"Test if the contact form on mysite.com submits correctly"
-> Uses playwright (fast, no screenshot) -> text result

"Show me what the homepage of example.com looks like on mobile"
-> Uses playwright-vision -> full page screenshot sent to chat

"Check if my Railway deployment is responding and returning 200"
-> Uses playwright (fast) -> status report, no image needed
```

You can also explicitly say:
- "use vision mode" -> forces playwright-vision
- "no screenshot needed, just test it" -> forces fast playwright

### MCP Servers (auto-wired on startup)

| Server | Always On | Needs |
|--------|-----------|-------|
| `playwright` | Yes | — |
| `playwright-vision` | Yes | — |
| `filesystem` | Yes | — |
| `fetch` | Yes | — |
| `sequential-thinking` | Yes | — |
| `sqlite` | Yes | — |
| `brave-search` | If key set | `BRAVE_SEARCH_API_KEY` |
| `github` | If key set | `GITHUB_TOKEN` |
| custom extras | If listed | `MCP_SERVERS` env var |

### Additional Tools Baked into Image

- **SearXNG** — self-hosted private search engine (companion Railway service)
- **signal-cli** — Signal messaging channel support
- **Google Workspace CLI (gog skill)** — Gmail, Calendar, Drive, Contacts, Sheets, Docs
- **Linuxbrew** — Homebrew for Linux, for installing extra tools at runtime
- **Go runtime** — for gmlis and Go-based tools
- **uv** — fast Python package manager for Python-based skills

---

## Quick Deploy

1. Click **Deploy on Railway** above
2. Add a Volume mounted at `/data` (required — all state lives here)
3. Set `SETUP_PASSWORD` and at least one AI provider API key
4. Visit `https://your-app.railway.app/onboard` to complete setup
5. Connect your messaging channel (Telegram recommended)
6. Start chatting

---

## Web Endpoints

| Route | Auth | Description |
|-------|------|-------------|
| `/health` | None | Health check — always returns 200 |
| `/onboard` | SETUP_PASSWORD | Initial setup wizard |
| `/lite` | SETUP_PASSWORD | Management dashboard |
| `/tui` | SETUP_PASSWORD | Web terminal (openclaw tui in browser) |
| `/tools` | SETUP_PASSWORD | Tool status — shows installed CLIs + MCP servers |
| `/*` | Gateway token | OpenClaw Control UI |

---

## Enabling Google Workspace (Gmail, Calendar, Drive, Contacts)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable these APIs: Gmail API, Google Calendar API, Google Drive API, Google Contacts API
4. Go to **Credentials** -> Create Credentials -> OAuth 2.0 Client ID -> Desktop app
5. Download the `credentials.json` file
6. Base64-encode it (run this locally):
   ```bash
   base64 -i credentials.json | tr -d '\n'
   ```
7. Paste the output as `GOOGLE_OAUTH_CREDENTIALS_B64` in Railway Variables
8. Redeploy — credentials decode to `/data/google/credentials.json` automatically
9. Ask OpenClaw: `"set up Google Workspace access"` to complete the OAuth flow

---

## Checking Tool Status

Visit `https://your-app.railway.app/tools` (requires SETUP_PASSWORD) to see:
- All installed CLI tools and their versions
- Active MCP servers
- Which API keys are configured (values hidden, just shows set/not set)

---

## Architecture

```
Request -> Express Wrapper ($PORT)
   |-- /health           -> Health check (no auth)
   |-- /onboard          -> Setup wizard (SETUP_PASSWORD)
   |-- /lite             -> Management dashboard (SETUP_PASSWORD)
   |-- /tui              -> Web terminal (SETUP_PASSWORD)
   |-- /tools            -> Tool status (SETUP_PASSWORD)
   \-- /*                -> OpenClaw Gateway (127.0.0.1:18789)

Persistent Volume /data/
   .openclaw/            <- OpenClaw state + openclaw.json (MCP servers wired)
   workspace/            <- OpenClaw workspace files
   .npm-global/          <- claude, codex, gemini, MCP server packages
   google/               <- Google OAuth credentials (decoded from env var)
   signal/               <- signal-cli data directory
   browser/
     screenshots/        <- Playwright screenshots (sent to Telegram/Discord)
     profile/            <- Chromium persistent session/cookie storage

Companion Service: SearXNG
   Internal URL: http://searxng:8080
   Wired into OpenClaw as default private web search provider
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SETUP_PASSWORD` | auto-generated | Protects /onboard, /lite, /tui, /tools |
| `OPENCLAW_STATE_DIR` | `/data/.openclaw` | OpenClaw config and state directory |
| `OPENCLAW_WORKSPACE_DIR` | `/data/workspace` | OpenClaw workspace directory |
| `OPENCLAW_GATEWAY_TOKEN` | auto-generated | Internal gateway auth token |
| `PORT` | `8080` | Wrapper HTTP port |
| `ANTHROPIC_API_KEY` | — | Claude Code CLI + Claude models |
| `OPENAI_API_KEY` | — | OpenAI Codex CLI + GPT models |
| `GEMINI_API_KEY` | — | Gemini CLI + Gemini models |
| `OPENROUTER_API_KEY` | — | All OpenRouter models |
| `TELEGRAM_BOT_TOKEN` | — | Telegram messaging channel |
| `DISCORD_BOT_TOKEN` | — | Discord messaging channel |
| `SLACK_BOT_TOKEN` | — | Slack bot token (xoxb-...) |
| `SLACK_APP_TOKEN` | — | Slack app token (xapp-...) |
| `SIGNAL_PHONE_NUMBER` | — | Signal channel phone number |
| `GOOGLE_OAUTH_CREDENTIALS_B64` | — | Base64 Google OAuth JSON |
| `BRAVE_SEARCH_API_KEY` | — | Brave Search MCP server |
| `GITHUB_TOKEN` | — | GitHub MCP server |
| `OPENCLAW_VERSION` | auto-detect | Pin specific release e.g. v2026.2.19 |
| `MCP_SERVERS` | `""` | Extra MCP packages (comma-separated) |
| `ENABLE_WEB_TUI` | `true` | Web terminal at /tui |

---

## Based On

- [protemplate/openclaw-railway](https://github.com/protemplate/openclaw-railway) — All-in-One Bundle base
- [openclaw/openclaw](https://github.com/openclaw/openclaw) — Core OpenClaw framework
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — Playwright MCP server
