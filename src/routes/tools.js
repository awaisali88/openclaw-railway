// src/routes/tools.js
// Shows status of all installed AI CLI tools and active MCP servers.
// Accessible at /tools — requires SETUP_PASSWORD auth.

import { Router } from 'express';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const router = Router();

function tryVersion(cmd) {
  try {
    return execSync(cmd, { timeout: 5000, shell: true }).toString().trim();
  } catch {
    return 'not found';
  }
}

router.get('/', (req, res) => {
  const tools = {
    'claude (Claude Code)':    tryVersion('claude --version'),
    'codex (OpenAI Codex)':    tryVersion('codex --version'),
    'gemini (Gemini CLI)':     tryVersion('gemini --version'),
    'gmlis (Gmail CLI)':       tryVersion('gmlis --version'),
    'playwright MCP':          tryVersion('npx @playwright/mcp --version 2>/dev/null || echo installed'),
    'go':                      tryVersion('go version'),
    'uv (Python)':             tryVersion('uv --version'),
    'node':                    tryVersion('node --version'),
    'npm':                     tryVersion('npm --version'),
  };

  const mcpServers = (() => {
    try {
      const cfgPath = `${process.env.OPENCLAW_STATE_DIR || '/data/.openclaw'}/openclaw.json`;
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      return Object.keys(cfg.mcp?.servers || {});
    } catch {
      return [];
    }
  })();

  res.json({
    timestamp: new Date().toISOString(),
    tools,
    mcpServers,
    env: {
      ANTHROPIC_API_KEY:              process.env.ANTHROPIC_API_KEY              ? 'set' : 'not set',
      OPENAI_API_KEY:                 process.env.OPENAI_API_KEY                 ? 'set' : 'not set',
      GEMINI_API_KEY:                 process.env.GEMINI_API_KEY                 ? 'set' : 'not set',
      GOOGLE_OAUTH_CREDENTIALS_B64:   process.env.GOOGLE_OAUTH_CREDENTIALS_B64   ? 'set' : 'not set',
      BRAVE_SEARCH_API_KEY:           process.env.BRAVE_SEARCH_API_KEY           ? 'set' : 'not set',
      GITHUB_TOKEN:                   process.env.GITHUB_TOKEN                   ? 'set' : 'not set',
    },
  });
});

export default router;
