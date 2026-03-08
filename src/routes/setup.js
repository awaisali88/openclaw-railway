/**
 * /setup wizard router
 *
 * Browser-based onboarding wizard ported from clawdbot-railway-template.
 * Uses existing gateway.js exports and auth.js middleware.
 */

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, resolve, relative, sep } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { createAuthMiddleware } from '../auth.js';
import {
  startGateway, stopGateway, isGatewayRunning, getGatewayToken,
  runCmd, runExec, deleteConfig
} from '../gateway.js';

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/data/.openclaw';
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
const INTERNAL_GATEWAY_PORT = process.env.INTERNAL_GATEWAY_PORT || '18789';

// ── Auth groups (provider list) ────────────────────────────────────────────────
const AUTH_GROUPS = [
  { value: 'openai', label: 'OpenAI', hint: 'Codex OAuth + API key', options: [
    { value: 'codex-cli', label: 'OpenAI Codex OAuth (Codex CLI)' },
    { value: 'openai-codex', label: 'OpenAI Codex (ChatGPT OAuth)' },
    { value: 'openai-api-key', label: 'OpenAI API key' },
  ]},
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude Code CLI + API key', options: [
    { value: 'claude-cli', label: 'Anthropic token (Claude Code CLI)' },
    { value: 'token', label: 'Anthropic token (paste setup-token)' },
    { value: 'apiKey', label: 'Anthropic API key' },
  ]},
  { value: 'google', label: 'Google', hint: 'Gemini API key + OAuth', options: [
    { value: 'gemini-api-key', label: 'Google Gemini API key' },
    { value: 'google-antigravity', label: 'Google Antigravity OAuth' },
    { value: 'google-gemini-cli', label: 'Google Gemini CLI OAuth' },
  ]},
  { value: 'openrouter', label: 'OpenRouter', hint: 'API key', options: [
    { value: 'openrouter-api-key', label: 'OpenRouter API key' },
  ]},
  { value: 'ai-gateway', label: 'Vercel AI Gateway', hint: 'API key', options: [
    { value: 'ai-gateway-api-key', label: 'Vercel AI Gateway API key' },
  ]},
  { value: 'moonshot', label: 'Moonshot AI', hint: 'Kimi K2 + Kimi Code', options: [
    { value: 'moonshot-api-key', label: 'Moonshot AI API key' },
    { value: 'kimi-code-api-key', label: 'Kimi Code API key' },
  ]},
  { value: 'zai', label: 'Z.AI (GLM 4.7)', hint: 'API key', options: [
    { value: 'zai-api-key', label: 'Z.AI (GLM 4.7) API key' },
  ]},
  { value: 'minimax', label: 'MiniMax', hint: 'M2.1', options: [
    { value: 'minimax-api', label: 'MiniMax M2.1' },
    { value: 'minimax-api-lightning', label: 'MiniMax M2.1 Lightning' },
  ]},
  { value: 'qwen', label: 'Qwen', hint: 'OAuth', options: [
    { value: 'qwen-portal', label: 'Qwen OAuth' },
  ]},
  { value: 'copilot', label: 'Copilot', hint: 'GitHub + local proxy', options: [
    { value: 'github-copilot', label: 'GitHub Copilot (GitHub device login)' },
    { value: 'copilot-proxy', label: 'Copilot Proxy (local)' },
  ]},
  { value: 'synthetic', label: 'Synthetic', hint: 'Anthropic-compatible (multi-model)', options: [
    { value: 'synthetic-api-key', label: 'Synthetic API key' },
  ]},
  { value: 'opencode-zen', label: 'OpenCode Zen', hint: 'API key', options: [
    { value: 'opencode-zen', label: 'OpenCode Zen (multi-model proxy)' },
  ]},
];

// ── Secret redaction ──────────────────────────────────────────────────────────
function redactSecrets(text) {
  if (!text) return text;
  return String(text)
    .replace(/(sk-[A-Za-z0-9_-]{10,})/g, '[REDACTED]')
    .replace(/(gho_[A-Za-z0-9_]{10,})/g, '[REDACTED]')
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, '[REDACTED]')
    .replace(/(\d{5,}:[A-Za-z0-9_-]{10,})/g, '[REDACTED]')
    .replace(/(AA[A-Za-z0-9_-]{10,}:\S{10,})/g, '[REDACTED]');
}

function extractDeviceRequestIds(text) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(/requestId\s*(?:=|:)\s*([A-Za-z0-9_-]{6,})/g)) out.add(m[1]);
  for (const m of s.matchAll(/"requestId"\s*:\s*"([A-Za-z0-9_-]{6,})"/g)) out.add(m[1]);
  return Array.from(out);
}

function isConfigured() {
  return existsSync(join(STATE_DIR, 'openclaw.json'));
}

function configPath() {
  return join(STATE_DIR, 'openclaw.json');
}

// ── Onboard args builder ──────────────────────────────────────────────────────
function buildOnboardArgs(payload) {
  const token = getGatewayToken();
  const args = [
    'onboard', '--non-interactive', '--accept-risk', '--json', '--no-install-daemon',
    '--skip-health', '--workspace', WORKSPACE_DIR,
    '--gateway-bind', 'loopback', '--gateway-port', String(INTERNAL_GATEWAY_PORT),
    '--gateway-auth', 'token', '--gateway-token', token,
    '--flow', payload.flow || 'quickstart',
  ];
  if (payload.authChoice) {
    args.push('--auth-choice', payload.authChoice);
    const secret = (payload.authSecret || '').trim();
    const map = {
      'openai-api-key': '--openai-api-key', 'apiKey': '--anthropic-api-key',
      'openrouter-api-key': '--openrouter-api-key', 'ai-gateway-api-key': '--ai-gateway-api-key',
      'moonshot-api-key': '--moonshot-api-key', 'kimi-code-api-key': '--kimi-code-api-key',
      'gemini-api-key': '--gemini-api-key', 'zai-api-key': '--zai-api-key',
      'minimax-api': '--minimax-api-key', 'minimax-api-lightning': '--minimax-api-key',
      'synthetic-api-key': '--synthetic-api-key', 'opencode-zen': '--opencode-zen-api-key',
    };
    const flag = map[payload.authChoice];
    if (flag && !secret) throw new Error(`Missing auth secret for authChoice=${payload.authChoice}`);
    if (flag) args.push(flag, secret);
    if (payload.authChoice === 'token') {
      if (!secret) throw new Error('Missing auth secret for authChoice=token');
      args.push('--token-provider', 'anthropic', '--token', secret);
    }
  }
  return args;
}

const router = Router();

// ── /setup/healthz — no auth, for Railway healthcheck ────────────────────────
router.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Apply auth middleware to all routes below
const SETUP_PASSWORD = process.env.SETUP_PASSWORD;
const authMiddleware = createAuthMiddleware(SETUP_PASSWORD);

// ── Serve setup page ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>OpenClaw Setup</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 2rem; max-width: 960px; background: #0f0f11; color: #e8e8e8; }
    h1 { color: #7c3aed; } h2 { color: #a78bfa; border-bottom: 1px solid #2a2a3a; padding-bottom: 0.4rem; }
    .card { border: 1px solid #2a2a3a; border-radius: 12px; padding: 1.25rem; margin: 1rem 0; background: #18181f; }
    label { display:block; margin-top: 0.75rem; font-weight: 600; color: #c4b5fd; }
    input, select { width: 100%; padding: 0.6rem; margin-top: 0.25rem; background: #0f0f11; border: 1px solid #3a3a4a; border-radius: 6px; color: #e8e8e8; }
    button { padding: 0.8rem 1.2rem; border-radius: 10px; border: 0; background: #7c3aed; color: #fff; font-weight: 700; cursor: pointer; margin-top: 0.4rem; }
    button:hover { background: #6d28d9; }
    code { background: #1e1e2e; padding: 0.1rem 0.3rem; border-radius: 6px; font-family: ui-monospace, monospace; }
    .muted { color: #888; }
    pre { background: #0a0a0f; border: 1px solid #2a2a3a; border-radius: 8px; padding: 0.8rem; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 0.85rem; max-height: 400px; overflow-y: auto; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
    .badge-green { background: #14532d; color: #86efac; }
    .badge-yellow { background: #713f12; color: #fde68a; }
  </style>
</head>
<body>
  <h1>OpenClaw Setup</h1>
  <p class="muted">Configure OpenClaw without SSH. All settings are persisted to the Railway volume at <code>/data</code>.</p>

  <div class="card">
    <h2>Status</h2>
    <div id="status">Loading...</div>
    <div id="statusDetails" class="muted" style="margin-top:0.5rem"></div>
    <div style="margin-top: 0.75rem">
      <a href="/openclaw" target="_blank" style="color:#a78bfa">Open OpenClaw UI</a>
      &nbsp;|&nbsp;
      <a href="/setup/export" target="_blank" style="color:#a78bfa">Download backup (.tar.gz)</a>
      &nbsp;|&nbsp;
      <a href="/tools" target="_blank" style="color:#a78bfa">Tool status</a>
    </div>
    <div style="margin-top: 0.75rem">
      <div class="muted" style="margin-bottom:0.25rem"><strong>Import backup</strong> (advanced): restores into <code>/data</code> and restarts the gateway.</div>
      <input id="importFile" type="file" accept=".tar.gz,application/gzip"/>
      <button id="importRun" style="background:#7c2d12; margin-top:0.5rem">Import</button>
      <pre id="importOut"></pre>
    </div>
  </div>

  <div class="card">
    <h2>Debug console</h2>
    <p class="muted">Run safe allowlisted commands. No SSH needed.</p>
    <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap">
      <select id="consoleCmd" style="flex: 1; min-width: 220px">
        <option value="gateway.restart">gateway.restart</option>
        <option value="gateway.stop">gateway.stop</option>
        <option value="gateway.start">gateway.start</option>
        <option value="openclaw.status">openclaw status</option>
        <option value="openclaw.health">openclaw health</option>
        <option value="openclaw.doctor">openclaw doctor</option>
        <option value="openclaw.logs.tail">openclaw logs --tail N</option>
        <option value="openclaw.config.get">openclaw config get &lt;path&gt;</option>
        <option value="openclaw.version">openclaw --version</option>
        <option value="openclaw.devices.list">openclaw devices list</option>
        <option value="openclaw.devices.approve">openclaw devices approve &lt;requestId&gt;</option>
        <option value="openclaw.plugins.list">openclaw plugins list</option>
        <option value="openclaw.plugins.enable">openclaw plugins enable &lt;name&gt;</option>
      </select>
      <input id="consoleArg" placeholder="Optional arg" style="flex: 1; min-width: 160px"/>
      <button id="consoleRun" style="background:#1f2937">Run</button>
    </div>
    <pre id="consoleOut"></pre>
  </div>

  <div class="card">
    <h2>Config editor (advanced)</h2>
    <p class="muted">Edit the full config JSON. Saving creates a timestamped backup and restarts the gateway.</p>
    <div class="muted" id="configPath"></div>
    <textarea id="configText" style="width:100%; height:260px; font-family:ui-monospace,monospace; background:#0a0a0f; color:#e8e8e8; border:1px solid #2a2a3a; border-radius:8px; padding:0.6rem; margin-top:0.5rem"></textarea>
    <div style="margin-top:0.5rem">
      <button id="configReload" style="background:#1f2937">Reload</button>
      <button id="configSave" style="margin-left:0.5rem">Save</button>
    </div>
    <pre id="configOut"></pre>
  </div>

  <div class="card">
    <h2>1) Model / Auth provider</h2>
    <label>Provider group</label>
    <select id="authGroup"><option>Loading providers...</option></select>
    <label>Auth method</label>
    <select id="authChoice"><option>Loading methods...</option></select>
    <label>Key / Token (if required)</label>
    <input id="authSecret" type="password" placeholder="Paste API key / token if applicable"/>
    <label>Wizard flow</label>
    <select id="flow">
      <option value="quickstart">quickstart</option>
      <option value="advanced">advanced</option>
      <option value="manual">manual</option>
    </select>
  </div>

  <div class="card">
    <h2>2) Channels (optional)</h2>
    <label>Telegram bot token</label>
    <input id="telegramToken" type="password" placeholder="123456:ABC..."/>
    <div class="muted" style="margin-top:0.25rem">Get from <code>@BotFather</code> &rarr; <code>/newbot</code></div>
    <label>Discord bot token</label>
    <input id="discordToken" type="password" placeholder="Bot token"/>
    <div class="muted" style="margin-top:0.25rem">Enable <strong>MESSAGE CONTENT INTENT</strong> in Bot &rarr; Privileged Gateway Intents</div>
    <label>Slack bot token</label>
    <input id="slackBotToken" type="password" placeholder="xoxb-..."/>
    <label>Slack app token</label>
    <input id="slackAppToken" type="password" placeholder="xapp-..."/>
  </div>

  <div class="card">
    <h2>2b) Custom OpenAI-compatible provider (optional)</h2>
    <p class="muted">For Ollama, vLLM, LM Studio, hosted proxies, etc.</p>
    <label>Provider id (e.g. ollama)</label>
    <input id="customProviderId" placeholder="ollama"/>
    <label>Base URL (include /v1)</label>
    <input id="customProviderBaseUrl" placeholder="http://127.0.0.1:11434/v1"/>
    <label>API</label>
    <select id="customProviderApi">
      <option value="openai-completions">openai-completions</option>
      <option value="openai-responses">openai-responses</option>
    </select>
    <label>API key env var name (optional)</label>
    <input id="customProviderApiKeyEnv" placeholder="OLLAMA_API_KEY"/>
    <label>Model id (optional)</label>
    <input id="customProviderModelId" placeholder="llama3.1:8b"/>
  </div>

  <div class="card">
    <h2>3) Run onboarding</h2>
    <button id="run">Run setup</button>
    <button id="pairingApprove" style="background:#1f2937; margin-left:0.5rem">Approve pairing</button>
    <button id="reset" style="background:#7c2d12; margin-left:0.5rem">Reset setup</button>
    <pre id="log"></pre>
    <details style="margin-top:0.75rem">
      <summary style="cursor:pointer; color:#a78bfa"><strong>Pairing helper</strong> (for "disconnected (1008): pairing required")</summary>
      <button id="devicesRefresh" style="background:#1f2937; margin-top:0.5rem">Refresh pending devices</button>
      <div id="devicesList" class="muted" style="margin-top:0.5rem"></div>
    </details>
  </div>

  <script src="/setup/app.js"></script>
</body>
</html>`);
});

// ── Serve client JS ──────────────────────────────────────────────────────────
router.get('/app.js', authMiddleware, (_req, res) => {
  res.type('application/javascript');
  res.send(readFileSync(join(process.cwd(), 'src', 'setup-app.js'), 'utf8'));
});

// ── Status API ───────────────────────────────────────────────────────────────
router.get('/api/status', authMiddleware, async (_req, res) => {
  const version = await runCmd('--version');
  const channelsHelp = await runCmd('channels', ['add', '--help']);
  res.json({
    configured: isConfigured(),
    gatewayRunning: isGatewayRunning(),
    openclawVersion: version.stdout.trim(),
    channelsAddHelp: channelsHelp.stdout,
    authGroups: AUTH_GROUPS,
  });
});

router.get('/api/auth-groups', authMiddleware, (_req, res) => {
  res.json({ ok: true, authGroups: AUTH_GROUPS });
});

// ── Run setup ────────────────────────────────────────────────────────────────
router.post('/api/run', authMiddleware, async (req, res) => {
  try {
    if (isConfigured()) {
      if (!isGatewayRunning()) {
        try { await startGateway(); } catch { /* ignore */ }
      }
      return res.json({ ok: true, output: 'Already configured.\nUse Reset setup to rerun.\n' });
    }

    mkdirSync(STATE_DIR, { recursive: true });
    mkdirSync(WORKSPACE_DIR, { recursive: true });

    const payload = req.body || {};
    let onboardArgs;
    try {
      onboardArgs = buildOnboardArgs(payload);
    } catch (err) {
      return res.status(400).json({ ok: false, output: `Setup input error: ${String(err)}` });
    }

    const prefix = '[setup] running openclaw onboard...\n';
    const onboard = await runCmd('onboard', onboardArgs.slice(1));
    let extra = '';
    const ok = onboard.code === 0 && isConfigured();

    if (ok) {
      const token = getGatewayToken();
      // Set gateway config
      await runCmd('config', ['set', 'gateway.auth.mode', 'token']);
      await runCmd('config', ['set', 'gateway.auth.token', token]);
      await runCmd('config', ['set', 'gateway.remote.token', token]);
      await runCmd('config', ['set', 'gateway.bind', 'loopback']);
      await runCmd('config', ['set', 'gateway.port', String(INTERNAL_GATEWAY_PORT)]);

      // Custom OpenAI-compatible provider
      if (payload.customProviderId?.trim() && payload.customProviderBaseUrl?.trim()) {
        const providerId = payload.customProviderId.trim();
        const baseUrl = payload.customProviderBaseUrl.trim();
        const api = (payload.customProviderApi || 'openai-completions').trim();
        const apiKeyEnv = (payload.customProviderApiKeyEnv || '').trim();
        const modelId = (payload.customProviderModelId || '').trim();
        if (/^[A-Za-z0-9_-]+$/.test(providerId) && /^https?:\/\//.test(baseUrl)) {
          const providerCfg = {
            baseUrl, api,
            apiKey: apiKeyEnv ? '${' + apiKeyEnv + '}' : undefined,
            models: modelId ? [{ id: modelId, name: modelId }] : undefined,
          };
          await runCmd('config', ['set', 'models.mode', 'merge']);
          const set = await runCmd('config', ['set', '--json', `models.providers.${providerId}`, JSON.stringify(providerCfg)]);
          extra += `\n[custom provider] exit=${set.code}\n${set.stdout || '(no output)'}`;
        }
      }

      // Channels
      const channelsHelp = await runCmd('channels', ['add', '--help']);
      const helpText = channelsHelp.stdout || '';
      const supports = name => helpText.includes(name);

      if (payload.telegramToken?.trim()) {
        if (!supports('telegram')) {
          extra += '\n[telegram] skipped (not in this build)\n';
        } else {
          const cfgObj = { enabled: true, dmPolicy: 'pairing', botToken: payload.telegramToken.trim(), groupPolicy: 'allowlist', streamMode: 'partial' };
          const set = await runCmd('config', ['set', '--json', 'channels.telegram', JSON.stringify(cfgObj)]);
          const plug = await runCmd('plugins', ['enable', 'telegram']);
          extra += `\n[telegram] exit=${set.code}\n[telegram plugin] exit=${plug.code}`;
        }
      }
      if (payload.discordToken?.trim()) {
        if (!supports('discord')) {
          extra += '\n[discord] skipped\n';
        } else {
          const cfgObj = { enabled: true, token: payload.discordToken.trim(), groupPolicy: 'allowlist', dm: { policy: 'pairing' } };
          const set = await runCmd('config', ['set', '--json', 'channels.discord', JSON.stringify(cfgObj)]);
          extra += `\n[discord] exit=${set.code}`;
        }
      }
      if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
        if (!supports('slack')) {
          extra += '\n[slack] skipped\n';
        } else {
          const cfgObj = { enabled: true, botToken: payload.slackBotToken?.trim() || undefined, appToken: payload.slackAppToken?.trim() || undefined };
          const set = await runCmd('config', ['set', '--json', 'channels.slack', JSON.stringify(cfgObj)]);
          extra += `\n[slack] exit=${set.code}`;
        }
      }

      // Restart gateway with new config
      try { await stopGateway(); } catch { /* ignore */ }
      try { await startGateway(); } catch { /* ignore */ }

      const fix = await runCmd('doctor', ['--fix']);
      extra += `\n[doctor --fix] exit=${fix.code}\n${fix.stdout || '(no output)'}`;

      // Restart again after doctor fix
      try { await stopGateway(); } catch { /* ignore */ }
      try { await startGateway(); } catch { /* ignore */ }
    }

    res.json({ ok, output: `${prefix}${onboard.stdout}${extra}` });
  } catch (err) {
    console.error('[/setup/api/run] error:', err);
    res.status(500).json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

// ── Debug API ────────────────────────────────────────────────────────────────
router.get('/api/debug', authMiddleware, async (_req, res) => {
  const v = await runCmd('--version');
  const tg = await runCmd('config', ['get', 'channels.telegram']);
  const dc = await runCmd('config', ['get', 'channels.discord']);
  res.json({
    wrapper: {
      node: process.version,
      port: process.env.PORT || 8080,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configured: isConfigured(),
      configPath: configPath(),
      internalGatewayPort: INTERNAL_GATEWAY_PORT,
      gatewayRunning: isGatewayRunning(),
    },
    openclaw: {
      version: v.stdout.trim(),
      channels: {
        telegram: { exit: tg.code, output: redactSecrets(tg.stdout) },
        discord: { exit: dc.code, output: redactSecrets(dc.stdout) },
      },
    },
  });
});

// ── Debug console ────────────────────────────────────────────────────────────
const ALLOWED_CONSOLE_COMMANDS = new Set([
  'gateway.restart', 'gateway.stop', 'gateway.start',
  'openclaw.version', 'openclaw.status', 'openclaw.health', 'openclaw.doctor',
  'openclaw.logs.tail', 'openclaw.config.get',
  'openclaw.devices.list', 'openclaw.devices.approve',
  'openclaw.plugins.list', 'openclaw.plugins.enable',
]);

router.post('/api/console/run', authMiddleware, async (req, res) => {
  const payload = req.body || {};
  const cmd = String(payload.cmd || '').trim();
  const arg = String(payload.arg || '').trim();
  if (!ALLOWED_CONSOLE_COMMANDS.has(cmd)) {
    return res.status(400).json({ ok: false, error: 'Command not allowed' });
  }
  try {
    if (cmd === 'gateway.restart') {
      await stopGateway();
      await startGateway();
      return res.json({ ok: true, output: 'Gateway restarted.\n' });
    }
    if (cmd === 'gateway.stop') {
      await stopGateway();
      return res.json({ ok: true, output: 'Gateway stopped.\n' });
    }
    if (cmd === 'gateway.start') {
      if (isGatewayRunning()) return res.json({ ok: true, output: 'Gateway already running.\n' });
      if (!isConfigured()) return res.json({ ok: false, output: 'Not started: not configured\n' });
      await startGateway();
      return res.json({ ok: true, output: 'Gateway started.\n' });
    }
    if (cmd === 'openclaw.version') {
      const r = await runCmd('--version');
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.status') {
      const r = await runCmd('status');
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.health') {
      const r = await runCmd('health');
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.doctor') {
      const r = await runCmd('doctor');
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.logs.tail') {
      const lines = Math.max(50, Math.min(1000, parseInt(arg || '200', 10) || 200));
      const r = await runCmd('logs', ['--tail', String(lines)]);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.config.get') {
      if (!arg) return res.status(400).json({ ok: false, error: 'Missing config path' });
      const r = await runCmd('config', ['get', arg]);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.devices.list') {
      const r = await runCmd('devices', ['list']);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.devices.approve') {
      if (!arg || !/^[A-Za-z0-9_-]+$/.test(arg)) return res.status(400).json({ ok: false, error: 'Invalid device request ID' });
      const r = await runCmd('devices', ['approve', arg]);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.plugins.list') {
      const r = await runCmd('plugins', ['list']);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    if (cmd === 'openclaw.plugins.enable') {
      if (!arg || !/^[A-Za-z0-9_-]+$/.test(arg)) return res.status(400).json({ ok: false, error: 'Invalid plugin name' });
      const r = await runCmd('plugins', ['enable', arg]);
      return res.json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
    }
    return res.status(400).json({ ok: false, error: 'Unhandled command' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Config editor API ────────────────────────────────────────────────────────
router.get('/api/config/raw', authMiddleware, async (_req, res) => {
  try {
    const p = configPath();
    const exists = existsSync(p);
    res.json({ ok: true, path: p, exists, content: exists ? readFileSync(p, 'utf8') : '' });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.post('/api/config/raw', authMiddleware, async (req, res) => {
  try {
    const content = String((req.body && req.body.content) || '');
    if (content.length > 500_000) return res.status(413).json({ ok: false, error: 'Config too large' });
    mkdirSync(STATE_DIR, { recursive: true });
    const p = configPath();
    if (existsSync(p)) {
      const backupPath = `${p}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(p, backupPath);
    }
    writeFileSync(p, content, { encoding: 'utf8', mode: 0o600 });
    // Restart gateway if configured
    if (isConfigured() && isGatewayRunning()) {
      try { await stopGateway(); } catch { /* ignore */ }
      try { await startGateway(); } catch { /* ignore */ }
    }
    res.json({ ok: true, path: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Pairing & Devices ────────────────────────────────────────────────────────
router.post('/api/pairing/approve', authMiddleware, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) return res.status(400).json({ ok: false, error: 'Missing channel or code' });
  const r = await runCmd('pairing', ['approve', String(channel), String(code)]);
  return res.status(r.code === 0 ? 200 : 500).json({ ok: r.code === 0, output: r.stdout });
});

router.get('/api/devices/pending', authMiddleware, async (_req, res) => {
  const r = await runCmd('devices', ['list']);
  const output = redactSecrets(r.stdout);
  res.status(r.code === 0 ? 200 : 500).json({
    ok: r.code === 0,
    requestIds: extractDeviceRequestIds(output),
    output,
  });
});

router.post('/api/devices/approve', authMiddleware, async (req, res) => {
  const requestId = String((req.body && req.body.requestId) || '').trim();
  if (!requestId || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    return res.status(400).json({ ok: false, error: 'Invalid device request ID' });
  }
  const r = await runCmd('devices', ['approve', requestId]);
  return res.status(r.code === 0 ? 200 : 500).json({ ok: r.code === 0, output: redactSecrets(r.stdout) });
});

// ── Reset ────────────────────────────────────────────────────────────────────
router.post('/api/reset', authMiddleware, async (_req, res) => {
  try {
    await stopGateway();
    deleteConfig();
    res.type('text/plain').send('OK - stopped gateway and deleted config. You can rerun setup now.');
  } catch (err) {
    res.status(500).type('text/plain').send(String(err));
  }
});

// ── Export backup ────────────────────────────────────────────────────────────
router.get('/export', authMiddleware, async (_req, res) => {
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader('content-type', 'application/gzip');
  res.setHeader('content-disposition',
    `attachment; filename="openclaw-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz"`);

  const archive = archiver('tar', { gzip: true });
  archive.on('error', err => {
    console.error('[export]', err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });
  archive.pipe(res);
  archive.directory(STATE_DIR, '.openclaw');
  archive.directory(WORKSPACE_DIR, 'workspace');
  archive.finalize();
});

// ── Import backup ────────────────────────────────────────────────────────────
router.post('/import', authMiddleware, async (req, res) => {
  try {
    const dataRoot = '/data';
    const stateAbs = resolve(STATE_DIR);
    const workspaceAbs = resolve(WORKSPACE_DIR);
    if (!stateAbs.startsWith(dataRoot + sep) && stateAbs !== dataRoot) {
      return res.status(400).type('text/plain').send('Import only supported when STATE_DIR is under /data.\n');
    }

    await stopGateway();

    // Read body into temp file
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (!buf.length) return res.status(400).type('text/plain').send('Empty body\n');

    const tmpPath = join(tmpdir(), `openclaw-import-${Date.now()}.tar.gz`);
    writeFileSync(tmpPath, buf);

    try {
      execSync(`tar xzf "${tmpPath}" -C "${dataRoot}"`, { timeout: 120000 });
    } finally {
      try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    }

    if (isConfigured()) {
      try { await startGateway(); } catch { /* ignore */ }
    }
    res.type('text/plain').send('OK - imported backup and restarted gateway.\n');
  } catch (err) {
    console.error('[import]', err);
    res.status(500).type('text/plain').send(String(err));
  }
});

export default router;
