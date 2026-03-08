// src/lib/mcp-config.js
// Reads openclaw.json, injects MCP server definitions, writes back.
// Called at startup after installAll().

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/data/.openclaw';
const CONFIG_PATH = join(STATE_DIR, 'openclaw.json');
const SCREENSHOTS_DIR = '/data/browser/screenshots';
const BROWSER_PROFILE_DIR = '/data/browser/profile';

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function ensureDirs() {
  [SCREENSHOTS_DIR, BROWSER_PROFILE_DIR].forEach(d => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  });
}

function buildMcpServers() {
  const servers = {};

  // BROWSER: FAST MODE (no vision, accessibility tree only)
  // Use for: testing, form checking, navigation, scraping text
  servers['playwright'] = {
    command: 'npx',
    args: [
      '@playwright/mcp@latest',
      '--headless',
      '--browser', 'chromium',
      '--output-dir', SCREENSHOTS_DIR,
      '--user-data-dir', BROWSER_PROFILE_DIR,
      '--caps', 'tabs,pdf,history,wait,files,install',
      '--viewport-size', '1280x720',
    ],
    env: { DISPLAY: '' },
  };

  // BROWSER: VISION MODE (screenshots returned as images)
  // Use for: "take a screenshot", "show me", "what does X look like"
  servers['playwright-vision'] = {
    command: 'npx',
    args: [
      '@playwright/mcp@latest',
      '--headless',
      '--vision',
      '--browser', 'chromium',
      '--output-dir', SCREENSHOTS_DIR,
      '--user-data-dir', BROWSER_PROFILE_DIR,
      '--caps', 'tabs,pdf,history,wait,files,install',
      '--viewport-size', '1280x720',
    ],
    env: { DISPLAY: '' },
  };

  // FILESYSTEM
  servers['filesystem'] = {
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/data/workspace',
      '/data/browser/screenshots',
    ],
  };

  // FETCH (web content retrieval)
  servers['fetch'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  };

  // SEQUENTIAL THINKING
  servers['sequential-thinking'] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  };

  // SQLITE (local database)
  servers['sqlite'] = {
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-sqlite',
      '--db-path', '/data/workspace/openclaw.db',
    ],
  };

  // BRAVE SEARCH (conditional on BRAVE_SEARCH_API_KEY)
  if (process.env.BRAVE_SEARCH_API_KEY) {
    servers['brave-search'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: process.env.BRAVE_SEARCH_API_KEY },
    };
  }

  // GITHUB MCP (conditional on GITHUB_TOKEN)
  if (process.env.GITHUB_TOKEN) {
    servers['github'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN },
    };
  }

  // EXTRA MCPs from MCP_SERVERS env var
  // Format: comma-separated package names e.g. "context7,@myorg/custom-mcp"
  const extras = (process.env.MCP_SERVERS || '').split(',').filter(Boolean);
  extras.forEach(pkg => {
    const name = pkg.trim().split('/').pop().replace(/^@/, '');
    servers[name] = {
      command: 'npx',
      args: ['-y', pkg.trim()],
    };
  });

  return servers;
}

export function injectMcpConfig() {
  ensureDirs();
  const cfg = readConfig();

  // Merge MCP servers — built-in servers first, existing custom servers win
  const builtServers = buildMcpServers();
  cfg.mcp = cfg.mcp || {};
  cfg.mcp.servers = Object.assign({}, builtServers, cfg.mcp.servers || {});

  // Inject shared memory paths so all agents index PROJECT.md and MEMORY.md
  cfg.agents = cfg.agents || {};
  cfg.agents.defaults = cfg.agents.defaults || {};
  cfg.agents.defaults.memorySearch = cfg.agents.defaults.memorySearch || {};

  if (!cfg.agents.defaults.memorySearch.additionalMemoryPaths) {
    cfg.agents.defaults.memorySearch.additionalMemoryPaths = [
      '/data/workspace/PROJECT.md',
      '/data/workspace/MEMORY.md',
    ];
    console.log('[mcp-config] additionalMemoryPaths set for shared project memory');
  }

  if (!cfg.agents.defaults.compaction) {
    cfg.agents.defaults.compaction = {
      reserveTokensFloor: 20000,
      memoryFlush: {
        enabled: true,
        softThresholdTokens: 4000,
        systemPrompt: 'Session nearing compaction. Store durable memories now.',
        prompt: "Update PROJECT.md with your output summary and write any lasting notes to memory/YYYY-MM-DD.md. Reply with NO_REPLY if nothing to store.",
      },
    };
    console.log('[mcp-config] memoryFlush configured');
  }

  writeConfig(cfg);
  console.log('[mcp-config] MCP servers configured:', Object.keys(cfg.mcp.servers).join(', '));
}
