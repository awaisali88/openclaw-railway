// src/setup-app.js
// Client-side JS for the /setup wizard

(async function () {
  // ── Status ─────────────────────────────────────────────────────────────────
  async function loadStatus() {
    try {
      const r = await fetch('/setup/api/status');
      const data = await r.json();
      document.getElementById('status').innerHTML =
        data.configured
          ? '<span class="badge badge-green">Configured</span>'
          : '<span class="badge badge-yellow">Not configured — complete setup below</span>';
      document.getElementById('statusDetails').textContent =
        `OpenClaw ${data.openclawVersion || '(unknown)'}` +
        (data.gatewayRunning ? ' — gateway running' : '');

      // Populate provider dropdown
      if (data.authGroups) {
        const groupSel = document.getElementById('authGroup');
        groupSel.innerHTML = '';
        for (const g of data.authGroups) {
          const opt = document.createElement('option');
          opt.value = g.value;
          opt.textContent = `${g.label} — ${g.hint}`;
          groupSel.appendChild(opt);
        }
        populateMethods(data.authGroups);
        groupSel.addEventListener('change', () => populateMethods(data.authGroups));
      }
    } catch (err) {
      document.getElementById('status').textContent = `Error loading status: ${err}`;
    }
  }

  function populateMethods(authGroups) {
    const groupSel = document.getElementById('authGroup');
    const methodSel = document.getElementById('authChoice');
    const group = authGroups.find(g => g.value === groupSel.value);
    methodSel.innerHTML = '';
    for (const opt of (group?.options || [])) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      methodSel.appendChild(el);
    }
  }

  await loadStatus();

  // ── Run setup ──────────────────────────────────────────────────────────────
  document.getElementById('run').addEventListener('click', async () => {
    const log = document.getElementById('log');
    log.textContent = 'Running setup...';
    try {
      const body = {
        authGroup: document.getElementById('authGroup').value,
        authChoice: document.getElementById('authChoice').value,
        authSecret: document.getElementById('authSecret').value,
        flow: document.getElementById('flow').value,
        telegramToken: document.getElementById('telegramToken').value,
        discordToken: document.getElementById('discordToken').value,
        slackBotToken: document.getElementById('slackBotToken').value,
        slackAppToken: document.getElementById('slackAppToken').value,
        customProviderId: document.getElementById('customProviderId').value,
        customProviderBaseUrl: document.getElementById('customProviderBaseUrl').value,
        customProviderApi: document.getElementById('customProviderApi').value,
        customProviderApiKeyEnv: document.getElementById('customProviderApiKeyEnv').value,
        customProviderModelId: document.getElementById('customProviderModelId').value,
      };
      const r = await fetch('/setup/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      log.textContent = data.output || JSON.stringify(data);
      if (data.ok) await loadStatus();
    } catch (err) {
      log.textContent = `Error: ${err}`;
    }
  });

  // ── Reset ──────────────────────────────────────────────────────────────────
  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirm('Delete OpenClaw config and reset? This will stop the gateway.')) return;
    const log = document.getElementById('log');
    try {
      const r = await fetch('/setup/api/reset', { method: 'POST' });
      const text = await r.text();
      log.textContent = text;
      await loadStatus();
    } catch (err) {
      log.textContent = `Error: ${err}`;
    }
  });

  // ── Pairing approve ────────────────────────────────────────────────────────
  document.getElementById('pairingApprove').addEventListener('click', async () => {
    const channel = prompt('Channel name (e.g. telegram):');
    if (!channel) return;
    const code = prompt('Pairing code:');
    if (!code) return;
    const log = document.getElementById('log');
    try {
      const r = await fetch('/setup/api/pairing/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, code }),
      });
      const data = await r.json();
      log.textContent = data.output || JSON.stringify(data);
    } catch (err) {
      log.textContent = `Error: ${err}`;
    }
  });

  // ── Debug console ──────────────────────────────────────────────────────────
  document.getElementById('consoleRun').addEventListener('click', async () => {
    const out = document.getElementById('consoleOut');
    out.textContent = 'Running...';
    try {
      const r = await fetch('/setup/api/console/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: document.getElementById('consoleCmd').value,
          arg: document.getElementById('consoleArg').value,
        }),
      });
      const data = await r.json();
      out.textContent = data.output || JSON.stringify(data);
    } catch (err) {
      out.textContent = `Error: ${err}`;
    }
  });

  // ── Config editor ──────────────────────────────────────────────────────────
  async function loadConfig() {
    const out = document.getElementById('configOut');
    try {
      const r = await fetch('/setup/api/config/raw');
      const data = await r.json();
      document.getElementById('configPath').textContent = `Config path: ${data.path}`;
      document.getElementById('configText').value = data.content || '';
      out.textContent = data.exists ? 'Config loaded' : '(no config yet)';
    } catch (err) {
      out.textContent = `Error loading config: ${err}`;
    }
  }
  await loadConfig();

  document.getElementById('configReload').addEventListener('click', loadConfig);

  document.getElementById('configSave').addEventListener('click', async () => {
    const out = document.getElementById('configOut');
    out.textContent = 'Saving...';
    try {
      const r = await fetch('/setup/api/config/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: document.getElementById('configText').value }),
      });
      const data = await r.json();
      out.textContent = data.ok ? `Saved to ${data.path} (gateway restarted)` : `Error: ${data.error}`;
    } catch (err) {
      out.textContent = `Error: ${err}`;
    }
  });

  // ── Devices (pairing helper) ───────────────────────────────────────────────
  document.getElementById('devicesRefresh').addEventListener('click', async () => {
    const el = document.getElementById('devicesList');
    try {
      const r = await fetch('/setup/api/devices/pending');
      const data = await r.json();
      if (data.requestIds && data.requestIds.length > 0) {
        el.innerHTML = data.requestIds.map(id =>
          `<div style="margin:0.4rem 0">${id} <button onclick="approveDevice('${id}')" style="background:#7c3aed; padding:0.3rem 0.7rem; font-size:0.8rem">Approve</button></div>`
        ).join('');
      } else {
        el.textContent = data.output ? `No pending requests found.\n${data.output}` : 'No pending requests.';
      }
    } catch (err) {
      el.textContent = `Error: ${err}`;
    }
  });

  window.approveDevice = async function (requestId) {
    const el = document.getElementById('devicesList');
    try {
      const r = await fetch('/setup/api/devices/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const data = await r.json();
      el.textContent = data.ok ? `Approved ${requestId}\n${data.output}` : `Error: ${data.output}`;
    } catch (err) {
      el.textContent = `Error: ${err}`;
    }
  };

  // ── Import backup ──────────────────────────────────────────────────────────
  document.getElementById('importRun').addEventListener('click', async () => {
    const file = document.getElementById('importFile').files[0];
    const out = document.getElementById('importOut');
    if (!file) { out.textContent = 'No file selected.'; return; }
    if (!confirm(`Import ${file.name}? This will overwrite /data content and restart the gateway.`)) return;
    out.textContent = 'Importing...';
    try {
      const r = await fetch('/setup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      out.textContent = await r.text();
      if (r.ok) await loadStatus();
    } catch (err) {
      out.textContent = `Error: ${err}`;
    }
  });

})();
