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

const app  = express();
const PORT = 3131;

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
