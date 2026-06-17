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

// Config directory for storing JSON files
const CONFIG_DIR = path.join(__dirname, 'config');
const { analyzeCache } = require('./lib/data-gaps');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

app.use(express.json());

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
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── Health check endpoint ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Proxy is running' });
});

// ── Config endpoints ──────────────────────────────────────────────────────────

// Get releases configuration
app.get('/config/releases', (req, res) => {
  const filePath = path.join(CONFIG_DIR, 'releases.json');
  if (!fs.existsSync(filePath)) {
    res.json({ releases: [], milestones: [] });
    return;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('[config read error]', err.message);
    res.status(500).json({ error: 'Failed to read config: ' + err.message });
  }
});

// Save releases configuration
app.post('/config/releases', (req, res) => {
  const filePath = path.join(CONFIG_DIR, 'releases.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    console.error('[config write error]', err.message);
    res.status(500).json({ error: 'Failed to save config: ' + err.message });
  }
});

// Get projects configuration
app.get('/config/projects', (req, res) => {
  const filePath = path.join(CONFIG_DIR, 'projects.json');
  if (!fs.existsSync(filePath)) {
    res.json({ customProjects: [], projectSettings: {} });
    return;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('[config read error]', err.message);
    res.status(500).json({ error: 'Failed to read config: ' + err.message });
  }
});

// Save projects configuration
app.post('/config/projects', (req, res) => {
  const filePath = path.join(CONFIG_DIR, 'projects.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    console.error('[config write error]', err.message);
    res.status(500).json({ error: 'Failed to save config: ' + err.message });
  }
});

// Get default projects
app.get('/config/projects/default', (req, res) => {
  const filePath = path.join(CONFIG_DIR, 'projects.default.json');
  if (!fs.existsSync(filePath)) {
    res.json({ defaultProjects: [] });
    return;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('[config read error]', err.message);
    res.status(500).json({ error: 'Failed to read config: ' + err.message });
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
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, '127.0.0.1', () => {
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
