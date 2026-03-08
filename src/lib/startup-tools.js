// src/lib/startup-tools.js
// Installs AI CLI tools to persistent volume at startup.
// Tools land in /data/.npm-global/bin which is on PATH.

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_NPM = process.env.DATA_NPM_GLOBAL || '/data/.npm-global';
const BIN = join(DATA_NPM, 'bin');

function npmGlobalInstall(pkg, envVarRequired, envVarName) {
  if (envVarRequired && !process.env[envVarName]) {
    console.log(`[startup-tools] Skipping ${pkg} — ${envVarName} not set`);
    return;
  }
  const binName = pkg.split('/').pop().replace(/^@/, '');
  const binPath = join(BIN, binName);
  if (existsSync(binPath)) {
    console.log(`[startup-tools] ${pkg} already installed at ${binPath}`);
    return;
  }
  try {
    console.log(`[startup-tools] Installing ${pkg}...`);
    execSync(`npm install -g ${pkg}`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_prefix: DATA_NPM,
      },
    });
    console.log(`[startup-tools] ${pkg} installed`);
  } catch (err) {
    console.error(`[startup-tools] Failed to install ${pkg}:`, err.message);
  }
}

async function decodeGoogleCredentials() {
  const b64 = process.env.GOOGLE_OAUTH_CREDENTIALS_B64;
  if (!b64) return;
  const dir = '/data/google';
  const dest = join(dir, 'credentials.json');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    JSON.parse(decoded); // validate it's valid JSON before writing
    writeFileSync(dest, decoded, { mode: 0o600 });
    console.log('[startup-tools] Google OAuth credentials decoded to', dest);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = dest;
  } catch (err) {
    console.error('[startup-tools] Failed to decode Google credentials:', err.message);
  }
}

export async function installAll() {
  // Ensure persistent npm global dir exists
  if (!existsSync(BIN)) mkdirSync(BIN, { recursive: true });

  // AI CLI tools (conditional on API keys)
  npmGlobalInstall('@anthropic-ai/claude-code', true, 'ANTHROPIC_API_KEY');
  npmGlobalInstall('@openai/codex', true, 'OPENAI_API_KEY');
  npmGlobalInstall('@google/gemini-cli', true, 'GEMINI_API_KEY');

  // MCP servers are now handled at Docker build time via OPENCLAW_EXTENSIONS

  // Google Workspace credentials decode
  await decodeGoogleCredentials();
}
