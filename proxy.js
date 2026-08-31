/**
 * Jira Dashboard — Local Proxy Server
 * Runs on http://localhost:3131
 * Forwards /jira-api/* → your Jira instance, adding CORS headers so the browser is happy.
 *
 * Usage:  node proxy.js
 * Then open http://localhost:3131 in your browser.
 */

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const http    = require('http');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = 3131;

// When packaged with pkg, static files live next to the executable.
const ROOT = typeof process.pkg !== 'undefined'
  ? path.dirname(process.execPath)
  : __dirname;

// Config directory for storing JSON files
const CONFIG_DIR = path.join(ROOT, 'config');
const { analyzeCache } = require('./lib/data-gaps');
const { analyzeRelease, mergeAiInsights, AI_RESPONSE_SCHEMA, adfToText } = require('./lib/release-report');
const { buildReleaseReportPptx, sanitizeFilename } = require('./lib/release-report-pptx');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((env, line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    return env;
  }, {});
}

const localEnv = loadEnvFile(path.join(CONFIG_DIR, '.env'));
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY || '';
const credentialEncryptionKey = process.env.JIRA_CREDENTIAL_ENCRYPTION_KEY || localEnv.JIRA_CREDENTIAL_ENCRYPTION_KEY || '';
const xaiApiKey = process.env.XAI_API_KEY || localEnv.XAI_API_KEY || '';

function credentialCipherKey() {
  return crypto.createHash('sha256').update(credentialEncryptionKey).digest();
}

function encryptCredential(value) {
  if (!credentialEncryptionKey) throw new Error('JIRA_CREDENTIAL_ENCRYPTION_KEY is missing');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptCredential(value) {
  if (!credentialEncryptionKey) throw new Error('JIRA_CREDENTIAL_ENCRYPTION_KEY is missing');
  const [iv, authTag, encrypted] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || !authTag || !encrypted) throw new Error('Invalid encrypted Jira credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialCipherKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

app.use(express.json({ limit: '20mb' }));

// ── CORS headers on every response ──────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// ── Serve the dashboard HTML ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'dashboard.html'));
});

// ── Health check endpoint ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Proxy is running' });
});

app.get('/config/supabase', (req, res) => {
  const url = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || localEnv.SUPABASE_ANON_KEY;
  const adminEmail = process.env.SUPABASE_ADMIN_EMAIL || localEnv.SUPABASE_ADMIN_EMAIL || '';
  const jiraUrl = process.env.JIRA_URL || localEnv.JIRA_URL || '';
  if (!url || !anonKey) {
    res.status(503).json({ error: 'Supabase configuration is missing' });
    return;
  }
  res.json({ url, anonKey, adminEmail, jiraUrl: jiraUrl.replace(/\/+$/, '') });
});

app.post('/api/bootstrap-admin', async (req, res) => {
  const adminEmail = String(process.env.SUPABASE_ADMIN_EMAIL || localEnv.SUPABASE_ADMIN_EMAIL || '').trim().toLowerCase();
  const supabaseUrl = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
  const accessToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!supabaseServiceRoleKey || !supabaseUrl || !adminEmail) {
    res.status(503).json({ error: 'Admin bootstrap is not configured' });
    return;
  }
  if (!accessToken) { res.status(401).json({ error: 'Missing user session' }); return; }
  try {
    const userResponse = await fetch(supabaseUrl.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: supabaseServiceRoleKey, Authorization: `Bearer ${accessToken}` },
    });
    const user = await userResponse.json();
    if (!userResponse.ok || !user.id || String(user.email || '').trim().toLowerCase() !== adminEmail) {
      res.status(403).json({ error: 'User is not the configured dashboard administrator' });
      return;
    }
    const memberResponse = await fetch(supabaseUrl.replace(/\/$/, '') + '/rest/v1/dashboard_members?on_conflict=user_id', {
      method: 'POST',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ user_id: user.id, email: user.email, role: 'admin' }),
    });
    if (!memberResponse.ok) throw new Error((await memberResponse.text()).slice(0, 300));
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin bootstrap]', err.message);
    res.status(502).json({ error: 'Admin bootstrap failed' });
  }
});

app.post('/api/shared-dashboard-state', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
  const adminEmail = String(process.env.SUPABASE_ADMIN_EMAIL || localEnv.SUPABASE_ADMIN_EMAIL || '').trim().toLowerCase();
  const accessToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!supabaseServiceRoleKey || !supabaseUrl || !adminEmail) {
    res.status(503).json({ error: 'Shared state service is not configured' });
    return;
  }
  if (!accessToken || !req.body?.state || typeof req.body.state !== 'object') {
    res.status(400).json({ error: 'Missing admin session or state object' });
    return;
  }
  try {
    const baseUrl = supabaseUrl.replace(/\/$/, '');
    const userResponse = await fetch(baseUrl + '/auth/v1/user', {
      headers: { apikey: supabaseServiceRoleKey, Authorization: `Bearer ${accessToken}` },
    });
    const user = await userResponse.json();
    if (!userResponse.ok || String(user.email || '').trim().toLowerCase() !== adminEmail) {
      res.status(403).json({ error: 'User is not the configured dashboard administrator' });
      return;
    }
    const stateResponse = await fetch(baseUrl + '/rest/v1/shared_dashboard_state?on_conflict=id', {
      method: 'POST',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ id: 1, state: req.body.state, updated_at: new Date().toISOString() }),
    });
    if (!stateResponse.ok) {
      const detail = (await stateResponse.text()).slice(0, 500);
      res.status(stateResponse.status).json({ error: detail || 'Could not save shared dashboard state' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[shared state save]', err.message);
    res.status(502).json({ error: 'Shared state save failed: ' + err.message });
  }
});

// Proxy Supabase Auth/REST traffic so the local dashboard is not blocked by CORS.
app.all('/supabase-api/*', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
  if (!supabaseUrl) { res.status(503).json({ error: 'Supabase configuration is missing' }); return; }
  const suffix = req.originalUrl.replace(/^\/supabase-api/, '');
  const target = supabaseUrl.replace(/\/$/, '') + suffix;
  const headers = {
    Accept: req.headers.accept || 'application/json',
    'Content-Type': req.headers['content-type'] || 'application/json',
  };
  ['authorization', 'apikey', 'x-client-info'].forEach(name => {
    if (req.headers[name]) headers[name] = req.headers[name];
  });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? JSON.stringify(req.body || {}) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await upstream.text();
    res.status(upstream.status)
      .set('Content-Type', upstream.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (err) {
    console.error('[supabase proxy error]', err.message);
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: 'Supabase proxy fetch failed: ' + err.message });
  }
});

function issueDescriptionText(issue) {
  const raw = issue?.fields?.description;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw;
  return adfToText(raw);
}

function compactTicketsForAi(projects, max = 80) {
  const rows = [];
  (projects || []).forEach(p => {
    (p.issues || []).forEach(issue => {
      const f = issue.fields || {};
      const desc = issueDescriptionText(issue).replace(/\s+/g, ' ').trim().slice(0, 700);
      rows.push({
        project: p.project?.key || p.project?.name || '',
        key: issue.key,
        summary: f.summary || '',
        type: f.issuetype?.name || f.issuetype?.value || '',
        priority: f.priority?.name || '',
        status: f.status?.name || '',
        description: desc,
      });
    });
  });
  rows.sort((a, b) => Number(!!b.description) - Number(!!a.description));
  return rows.slice(0, max);
}

async function enrichReleaseReportWithAi(report, body) {
  if (!xaiApiKey) {
    return { report, ai: { used: false, reason: 'XAI_API_KEY is not configured on the proxy' } };
  }
  const tickets = compactTicketsForAi(body.projects);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const payload = {
      model: 'grok-4.6',
      messages: [
        {
          role: 'system',
          content: 'You write internal company all-hands briefings for software releases. Be specific and factual. Use business language, not Jira jargon. Never invent tickets, dates, or metrics. High-value work is customer impact, contractual commitments, large capabilities, compliance/security, or work that unblocks other teams — not ticket volume. If a ticket description is thin, say so rather than guessing.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            releaseName: report.releaseName,
            reportKind: report.reportKind,
            portfolio: report.portfolio,
            projectSummaries: (report.projects || []).map(p => ({
              name: p.projectName,
              progress: p.progress,
              heuristicThemes: p.delivered?.themes,
              heuristicHighValue: p.highValue,
              heuristicRisks: p.risks,
              narrative: p.narrative,
            })),
            tickets,
          }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'release_report_insights',
          schema: AI_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    };
    const upstream = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + xaiApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = json.error?.message || json.error || `HTTP ${upstream.status}`;
      return { report, ai: { used: false, reason: 'SpaceXAI request failed: ' + String(detail).slice(0, 240) } };
    }
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return { report, ai: { used: false, reason: 'SpaceXAI returned an empty response' } };
    }
    const insights = typeof content === 'string' ? JSON.parse(content) : content;
    return { report: mergeAiInsights(report, insights), ai: { used: true } };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'SpaceXAI request timed out' : (err.message || 'SpaceXAI request failed');
    return { report, ai: { used: false, reason } };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/release-report/status', (req, res) => {
  res.json({ aiAvailable: !!xaiApiKey });
});

app.post('/api/release-report', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.projects) || !body.projects.length) {
      res.status(400).json({ error: 'Select at least one project with synced issues' });
      return;
    }
    let report = analyzeRelease(body);
    if (body.useAi) {
      const enriched = await enrichReleaseReportWithAi(report, body);
      report = enriched.report;
      report.ai = enriched.ai;
    } else {
      report.ai = { used: false };
    }
    res.json(report);
  } catch (err) {
    console.error('[release-report]', err.message);
    res.status(500).json({ error: err.message || 'Could not build release report' });
  }
});

app.post('/api/release-report/pptx', async (req, res) => {
  try {
    const report = req.body?.report;
    if (!report || !Array.isArray(report.projects) || !report.projects.length) {
      res.status(400).json({ error: 'Missing generated report' });
      return;
    }
    const buf = await buildReleaseReportPptx(report);
    const name = sanitizeFilename(report.releaseName) + '-release-report.pptx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  } catch (err) {
    console.error('[release-report-pptx]', err.message);
    res.status(500).json({ error: err.message || 'Could not build PowerPoint' });
  }
});

// Analyze cached dashboard data (POST { cache: S.cache })
app.post('/api/analyze-data-gaps', (req, res) => {
  try {
    const cache = req.body?.cache;
    if (!cache || typeof cache !== 'object') {
      res.status(400).json({ error: 'Missing cache object in request body' });
      return;
    }
    const report = analyzeCache(cache, req.body?.fieldEst, req.body?.fieldAct);
    console.log('[data-gaps]', JSON.stringify(report, null, 2));
    res.json(report);
  } catch (err) {
    console.error('[analyze-data-gaps]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jira-credentials/encrypt', (req, res) => {
  try {
    if (!req.body?.token) { res.status(400).json({ error: 'Missing Jira API token' }); return; }
    res.json({ tokenCiphertext: encryptCredential(req.body.token) });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/jira-credentials/decrypt', (req, res) => {
  try {
    if (!req.body?.tokenCiphertext) { res.status(400).json({ error: 'Missing encrypted Jira API token' }); return; }
    res.json({ token: decryptCredential(req.body.tokenCiphertext) });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/jira-credentials/check', async (req, res) => {
  try {
    const { url, email, tokenCiphertext } = req.body || {};
    if (!url || !email || !tokenCiphertext) { res.status(400).json({ error: 'Missing Jira credential data' }); return; }
    const token = decryptCredential(tokenCiphertext);
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const upstream = await fetch(url.replace(/\/+$/, '') + '/rest/api/3/myself', {
      headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
    });
    const responseBody = await upstream.json().catch(() => ({}));
    const detail = responseBody.errorMessages?.join(' ') || responseBody.message || '';
    res.status(upstream.ok ? 200 : 401).json({
      ok: upstream.ok,
      status: upstream.status,
      error: detail || (upstream.ok ? undefined : 'Jira rejected the credential check'),
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ── Proxy route: /jira-api/<encoded-jira-base-url>/<rest-of-path> ────────────
//
// The dashboard calls:
//   GET /jira-api?target=https://xxx.atlassian.net/rest/api/3/search?jql=...
//
// The proxy strips /jira-api, forwards to the real Jira URL, and returns the result.

app.all('/jira-api', async (req, res) => {
  const target = req.query.target;
  if (!target) { res.status(400).json({ error: 'Missing ?target= param' }); return; }

  // Authorization header forwarded from dashboard
  const auth = req.headers['authorization'] || req.headers['Authorization'];

  const headers = {
    'Accept':        'application/json',
    'Content-Type':  'application/json',
  };
  if (auth) headers['Authorization'] = auth;

  try {
    const method = req.method === 'OPTIONS' ? 'GET' : req.method;
    const upstream = await fetch(target, {
      method,
      headers,
      body: ['POST','PUT','PATCH'].includes(method) ? JSON.stringify(req.body) : undefined,
    });

    const contentType = upstream.headers.get('content-type') || '';
    const body = await upstream.text();

    res.status(upstream.status)
       .set('Content-Type', contentType || 'application/json')
       .send(body);
  } catch (err) {
    console.error('[proxy error]', err.message);
    res.status(502).json({ error: 'Proxy fetch failed: ' + err.message });
  }
});

// ── SPA fallback — deep-linked client routes serve dashboard.html ─────────────
app.get('*', (req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/jira-api') || p.startsWith('/supabase-api') || p.startsWith('/config') || p.startsWith('/api/') || p === '/health') {
    return next();
  }
  res.sendFile(path.join(ROOT, 'dashboard.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log('');
  console.log('  ✓  Jira Dashboard proxy running');
  console.log('  →  Open http://localhost:' + PORT + ' in your browser');
  console.log('');
  console.log('  Keep this terminal open while using the dashboard.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  // Try to auto-open the browser
  try {
    const open = require('open');
    open('http://localhost:' + PORT);
  } catch(e) {}
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('  ✗  Port ' + PORT + ' is already in use. Stop the other process or change PORT in proxy.js.');
  } else {
    console.error('  ✗  Server error:', err.message);
  }
  process.exit(1);
});
