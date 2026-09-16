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
const { buildReleaseReportHtml, htmlFilename, normalizeTicketGroupBy } = require('./lib/release-report-html');
const { createLocalStore } = require('./lib/local-store');
const { slimDashboardState, dashboardStateForClient } = require('./lib/slim-cache');
const { createPageConfig } = require('./lib/page-config');
const { ensureStatusPipelineFile, loadStatusPipeline } = require('./lib/status-pipeline');
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
const credentialEncryptionKey = process.env.JIRA_CREDENTIAL_ENCRYPTION_KEY || localEnv.JIRA_CREDENTIAL_ENCRYPTION_KEY || '';
const xaiApiKey = process.env.XAI_API_KEY || localEnv.XAI_API_KEY || '';
const adminEmail = String(process.env.ADMIN_EMAIL || localEnv.ADMIN_EMAIL || '').trim().toLowerCase();
const jiraBaseUrl = String(process.env.JIRA_URL || localEnv.JIRA_URL || '').replace(/\/+$/, '');
const DATA_DIR = path.join(ROOT, 'data');
const store = createLocalStore({
  dataDir: DATA_DIR,
  encryptionKey: credentialEncryptionKey,
  adminEmail,
});
const pageConfig = createPageConfig({ configDir: CONFIG_DIR });
try { ensureStatusPipelineFile(CONFIG_DIR); } catch (err) {
  console.warn('[status-pipeline] Could not create config/status-pipeline.json:', err.message);
}

function persistDashboardState(state, opts) {
  const slimmed = slimDashboardState(state);
  if (!opts || opts.pages !== false) pageConfig.writeFromState(slimmed);
  store.setSharedState(pageConfig.stripFromState(slimmed));
}

function loadDashboardState() {
  const merged = pageConfig.mergeIntoState(store.getSharedState());
  if (Array.isArray(merged._pageConfigErrors) && merged._pageConfigErrors.length) {
    merged._pageConfigErrors.forEach(message => console.warn('[page-config]', message));
  }
  return merged;
}

function compactStoredDashboardState() {
  const current = loadDashboardState();
  if (!current || typeof current !== 'object') return;
  const hasCache = current.cache && typeof current.cache === 'object' && Object.keys(current.cache).length;
  const hasReleaseCache = current.releaseCache && typeof current.releaseCache === 'object'
    && Object.keys(current.releaseCache).length;
  if (!hasCache && !hasReleaseCache) return;
  persistDashboardState(current, { pages: false });
}

function migratePageConfigFromStore() {
  const stored = store.getSharedState();
  const merged = pageConfig.migrateFromStore(stored);
  if (pageConfig.hasPageKeys(stored)) {
    store.setSharedState(pageConfig.stripFromState(slimDashboardState(merged)));
  }
}

try {
  const before = fs.existsSync(store.filePath) ? fs.statSync(store.filePath).size : 0;
  compactStoredDashboardState();
  migratePageConfigFromStore();
  const after = fs.existsSync(store.filePath) ? fs.statSync(store.filePath).size : 0;
  if (before && after && after < before) {
    console.log('[store] Compacted cached Jira data: '
      + Math.round(before / 1024 / 1024) + 'MB → '
      + Math.round(after / 1024 / 1024) + 'MB');
  }
} catch (err) {
  console.warn('[store] Could not compact cached Jira data:', err.message);
}

function accessTokenFrom(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function requireUser(req, res) {
  const session = store.getSession(accessTokenFrom(req));
  if (!session) {
    res.status(401).json({ error: 'Sign in again.' });
    return null;
  }
  return session.user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Only dashboard admins can change configuration.' });
    return null;
  }
  return user;
}

function sendStoreError(res, err) {
  res.status(err.status || 500).json({ error: err.message || 'Request failed' });
}

async function verifyJiraAccess(url, email, token) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const upstream = await fetch(String(url || '').replace(/\/+$/, '') + '/rest/api/3/myself', {
    headers: { Accept: 'application/json', Authorization: 'Basic ' + auth },
  });
  const responseBody = await upstream.json().catch(() => ({}));
  const detail = responseBody.errorMessages?.join(' ') || responseBody.message || '';
  return {
    ok: upstream.ok,
    status: upstream.status,
    error: detail || (upstream.ok ? undefined : 'Jira rejected the credential check'),
  };
}

const JSON_BODY_LIMIT = '100mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

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
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'dashboard.html'));
});

// ── Health check endpoint ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Proxy is running' });
});

app.get('/config/app', (req, res) => {
  if (!jiraBaseUrl) {
    res.status(503).json({ error: 'JIRA_URL is not configured in config/.env' });
    return;
  }
  res.json({ jiraUrl: jiraBaseUrl });
});

app.get('/config/status-pipeline', (req, res) => {
  const loaded = loadStatusPipeline(CONFIG_DIR);
  if (loaded.error) console.warn('[status-pipeline]', loaded.error);
  res.setHeader('Cache-Control', 'no-store');
  res.json(loaded.public);
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const jiraToken = String(req.body?.jiraToken || '').trim();
    if (!jiraBaseUrl) { res.status(503).json({ error: 'JIRA_URL is not configured' }); return; }
    if (!credentialEncryptionKey) { res.status(503).json({ error: 'JIRA_CREDENTIAL_ENCRYPTION_KEY is missing' }); return; }
    if (!jiraToken) { res.status(400).json({ error: 'Jira API token is required' }); return; }
    const check = await verifyJiraAccess(jiraBaseUrl, email, jiraToken);
    if (!check.ok) {
      res.status(400).json({ error: 'Jira access could not be verified. Check the URL, email, and API token.' });
      return;
    }
    const user = store.createUser({ email, password });
    store.claimCredentialsForUser(user.id, email);
    store.upsertCredentials(user.id, { jiraUrl: jiraBaseUrl, jiraEmail: email, token: jiraToken });
    res.json(store.createSession(user));
  } catch (err) {
    sendStoreError(res, err);
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    res.json(store.login({ email, password }));
  } catch (err) {
    sendStoreError(res, err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  store.destroySession(accessTokenFrom(req));
  res.json({ ok: true });
});

app.get('/api/auth/session', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ user });
});

app.get('/api/dashboard', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const credentials = store.getCredentials(user.id, { decrypt: true });
    if (credentials) {
      const check = await verifyJiraAccess(credentials.jiraUrl || jiraBaseUrl, credentials.jiraEmail, credentials.token);
      if (!check.ok) {
        store.destroySession(accessTokenFrom(req));
        res.status(401).json({
          error: check.error
            ? `Jira rejected the saved credentials (${check.status}): ${check.error}`
            : 'Your Jira access is no longer valid. Update your Jira credentials before signing in.',
          status: check.status,
          code: 'JIRA_CREDENTIALS_INVALID',
        });
        return;
      }
    }
    res.json({
      user,
      jiraUrl: jiraBaseUrl,
      credentials: credentials ? {
        jiraUrl: credentials.jiraUrl || jiraBaseUrl,
        jiraEmail: credentials.jiraEmail,
        token: credentials.token,
      } : null,
      state: dashboardStateForClient(loadDashboardState()),
    });
  } catch (err) {
    sendStoreError(res, err);
  }
});

app.post('/api/dashboard/state', (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;
  if (!req.body?.state || typeof req.body.state !== 'object') {
    res.status(400).json({ error: 'Missing state object' });
    return;
  }
  try {
    persistDashboardState(req.body.state);
    res.json({ ok: true });
  } catch (err) {
    sendStoreError(res, err);
  }
});

app.put('/api/credentials', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const email = String(req.body?.email || '').trim();
  const token = String(req.body?.token || '').trim();
  if (!email || !token) {
    res.status(400).json({ error: 'Jira email and API token are required' });
    return;
  }
  try {
    store.upsertCredentials(user.id, {
      jiraUrl: jiraBaseUrl,
      jiraEmail: email,
      token,
    });
    res.json({ ok: true });
  } catch (err) {
    sendStoreError(res, err);
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
          content: (() => {
            const quality = (report.projects || []).some(p => p.insightKind === 'quality');
            const delivery = (report.projects || []).some(p => p.insightKind !== 'quality');
            if (quality && !delivery) {
              return 'You write internal quality briefings for market releases and their patches. These projects are bugs and support tickets, not feature deliverables. Focus on severity, aging, unassigned work, customer-impacting defects, and what must be fixed before a patch ships. Never invent tickets, dates, or metrics. Do not describe bugs as high-value features. If a ticket description is thin, say so rather than guessing.';
            }
            if (quality && delivery) {
              return 'You write internal company all-hands briefings for software releases. Be specific and factual. Use business language, not Jira jargon. Never invent tickets, dates, or metrics. High-value work is customer impact, contractual commitments, large capabilities, compliance/security, or work that unblocks other teams — not ticket volume. Some projects are Quality (bugs and support tickets for patches): for those, write about defects, aging, and must-fix items — not feature value. If a ticket description is thin, say so rather than guessing.';
            }
            return 'You write internal company all-hands briefings for software releases. Be specific and factual. Use business language, not Jira jargon. Never invent tickets, dates, or metrics. High-value work is customer impact, contractual commitments, large capabilities, compliance/security, or work that unblocks other teams — not ticket volume. If a ticket description is thin, say so rather than guessing.';
          })(),
        },
        {
          role: 'user',
          content: JSON.stringify({
            releaseName: report.releaseName,
            reportKind: report.reportKind,
            portfolio: report.portfolio,
            projectSummaries: (report.projects || []).map(p => ({
              name: p.projectName,
              insightKind: p.insightKind || 'delivery',
              progress: p.progress,
              quality: p.quality,
              heuristicThemes: p.delivered?.themes,
              heuristicHighValue: p.highValue,
              heuristicMustFix: p.mustFix,
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
    const missing = /cannot find module ['"]pptxgenjs['"]/i.test(String(err.message || ''));
    res.status(500).json({
      error: missing
        ? "Cannot find module 'pptxgenjs'. From the Jira Dashboard folder run `npm install`, then restart the app."
        : (err.message || 'Could not build PowerPoint'),
    });
  }
});

app.post('/api/release-report/html', (req, res) => {
  try {
    const report = req.body?.report;
    if (!report || !Array.isArray(report.projects) || !report.projects.length) {
      res.status(400).json({ error: 'Missing generated report' });
      return;
    }
    const groupBy = normalizeTicketGroupBy(req.body.groupBy || report.ticketGroupBy);
    const html = buildReleaseReportHtml(report, {
      groupBy,
      jiraBaseUrl: String(req.body.jiraBaseUrl || '').replace(/\/+$/, ''),
    });
    const name = htmlFilename(report);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(html);
  } catch (err) {
    console.error('[release-report-html]', err.message);
    res.status(500).json({ error: err.message || 'Could not build ticket HTML' });
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
  if (p.startsWith('/jira-api') || p.startsWith('/config') || p.startsWith('/api/') || p === '/health') {
    return next();
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'dashboard.html'));
});

app.use((err, req, res, next) => {
  if (!err) { next(); return; }
  const tooLarge = err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413;
  if (tooLarge) {
    console.warn('[proxy] Request too large:', req.method, req.originalUrl || req.url);
    if (!res.headersSent) {
      res.status(413).json({ error: 'Request is too large. Refresh the dashboard and try again.' });
    }
    return;
  }
  console.error('[proxy]', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Request failed' });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log('');
  console.log('  ✓  Jira Dashboard proxy running');
  console.log('  →  Open http://localhost:' + PORT + ' in your browser');
  console.log('');
  console.log('  Local data: ' + DATA_DIR);
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
