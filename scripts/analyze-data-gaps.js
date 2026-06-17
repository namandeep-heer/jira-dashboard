/**
 * Analyze missing estimate/actual patterns from Jira or cached dashboard data.
 *
 * Live fetch:
 *   set JIRA_URL=https://your.atlassian.net
 *   set JIRA_EMAIL=you@company.com
 *   set JIRA_TOKEN=your-api-token
 *   node scripts/analyze-data-gaps.js
 *
 * Cached dashboard data (export from browser console: copy(JSON.stringify(S.cache))):
 *   node scripts/analyze-data-gaps.js --cache-file cache.json
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { analyzeCache, isDevWorkComplete } = require('../lib/data-gaps');

const ROOT = path.join(__dirname, '..');
const PROXY = 'http://127.0.0.1:3131/jira-api';

function loadProjects() {
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'projects.default.json'), 'utf8')).defaultProjects;
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'projects.json'), 'utf8')).projectSettings || {};
  return defaults
    .filter(p => settings[p.key]?.enabled !== false)
    .map(p => ({ ...p, jql: settings[p.key]?.jql || p.jql }));
}

async function fetchAllIssues(url, auth, jql) {
  const all = [];
  let nextPageToken = null;
  let isLast = false;

  while (!isLast) {
    const payload = { jql, fields: ['*navigable'], maxResults: 100 };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const target = `${url.replace(/\/$/, '')}/rest/api/3/search/jql`;
    const res = await fetch(`${PROXY}?target=${encodeURIComponent(target)}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const json = await res.json();
    all.push(...(json.issues || []));
    isLast = json.isLast !== false;
    nextPageToken = json.nextPageToken || null;
    if (!nextPageToken) break;
  }

  return all;
}

function printReport(report) {
  console.log('\n=== DATA GAPS REPORT ===');
  console.log(`Total issues: ${report.totalIssues}`);
  console.log(`Missing estimate: ${report.missingEstimate}`);
  console.log(`Post-dev, missing actual: ${report.devCompleteMissingActual}`);
  console.log(`In-dev, missing actual: ${report.inDevMissingActual}`);

  console.log('\nPost-dev statuses with missing actual:');
  Object.entries(report.byStatusMissingActualAfterDev || {})
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => console.log(`  ${count}\t${status}`));

  console.log('\nIn-dev statuses with missing actual (excluded from post-dev section):');
  const inDev = {};
  Object.entries(report.byStatusMissingActual || {}).forEach(([status, count]) => {
    if (!isDevWorkComplete(status)) inDev[status] = count;
  });
  Object.entries(inDev)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => console.log(`  ${count}\t${status}`));
}

async function main() {
  const cacheFileArg = process.argv.indexOf('--cache-file');
  if (cacheFileArg !== -1) {
    const file = process.argv[cacheFileArg + 1];
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    printReport(analyzeCache(cache));
    return;
  }

  const url = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_TOKEN;
  if (!url || !email || !token) {
    console.error('Missing JIRA_URL, JIRA_EMAIL, or JIRA_TOKEN. Or pass --cache-file cache.json');
    process.exit(1);
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const cache = {};

  for (const proj of loadProjects()) {
    console.log(`Fetching ${proj.key}...`);
    const issues = await fetchAllIssues(url, auth, proj.jql);
    console.log(`  ${issues.length} issues`);
    cache[proj.key] = { issues };
  }

  printReport(analyzeCache(cache));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});