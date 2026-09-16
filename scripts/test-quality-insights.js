/**
 * Unit tests for Quality Insights helpers.
 * Run: node scripts/test-quality-insights.js
 */

'use strict';

const assert = require('assert');

function qualityAgeBand(days) {
  const n = Number(days) || 0;
  if (n <= 7) return '0–7 days';
  if (n <= 14) return '8–14 days';
  if (n <= 30) return '15–30 days';
  if (n <= 60) return '31–60 days';
  return '60+ days';
}

function qualityModuleFromKey(key) {
  const m = String(key || '').match(/^([A-Z][A-Z0-9]+)-\d+/i);
  return m ? m[1].toUpperCase() : 'Other';
}

function jiraProjectsFromJql(jql) {
  const text = String(jql || '');
  const keys = [];
  const seen = new Set();
  function add(raw) {
    const k = String(raw || '').trim().replace(/^["']|["']$/g, '').toUpperCase();
    if (/^[A-Z][A-Z0-9_]*$/.test(k) && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  const inMatch = text.match(/project\s+in\s*\(([^)]*)\)/i);
  if (inMatch) inMatch[1].split(',').forEach(add);
  const eqRe = /project\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Z][A-Z0-9_]*))/gi;
  let m;
  while ((m = eqRe.exec(text))) add(m[1] || m[2] || m[3]);
  return keys;
}

function classifyQualityFixVersion(names, marketName, patches) {
  const patchSet = new Set(patches || []);
  const hasMarket = !!(marketName && names.includes(marketName));
  const hasPatch = names.some(n => patchSet.has(n));
  if (hasMarket && hasPatch) return 'Market + patch';
  if (hasPatch) return 'Patch only';
  if (hasMarket) return 'Market only';
  if (names.length) return 'Other fixVersion';
  return 'No fixVersion';
}

function countQualityBounces(issue) {
  let n = 0;
  ((issue && issue.changelog && issue.changelog.histories) || []).forEach(history => {
    (history.items || []).forEach(item => {
      if (/^(rejected|replied)/i.test(item.toString || '')) n += 1;
    });
  });
  return n;
}

function qualityJqlHidesLifecycle(jql) {
  const lower = String(jql || '').toLowerCase();
  return /status\s+not\s+in/.test(lower) && /\bqa\b/.test(lower);
}

function buildQualityPatchBreakdown(rows, marketName, patches) {
  const buckets = [];
  if (marketName) buckets.push({ label: marketName, kind: 'market', match: name => name === marketName });
  (patches || []).forEach(patch => {
    buckets.push({ label: patch, kind: 'patch', match: name => name === patch });
  });
  const known = new Set([marketName, ...(patches || [])].filter(Boolean));
  buckets.push({
    label: 'No / other fixVersion',
    kind: 'other',
    match: names => !names.length || names.every(n => !known.has(n)),
  });
  return buckets.map(bucket => {
    const subset = rows.filter(row => {
      if (bucket.kind === 'other') return bucket.match(row.fixVersions);
      return (row.fixVersions || []).some(bucket.match);
    });
    return {
      label: bucket.label,
      kind: bucket.kind,
      open: subset.length,
      blockers: subset.filter(r => r.severe).length,
    };
  });
}

assert.strictEqual(qualityAgeBand(3), '0–7 days');
assert.strictEqual(qualityAgeBand(14), '8–14 days');
assert.strictEqual(qualityAgeBand(21), '15–30 days');
assert.strictEqual(qualityAgeBand(45), '31–60 days');
assert.strictEqual(qualityAgeBand(90), '60+ days');

assert.strictEqual(qualityModuleFromKey('NFS-200'), 'NFS');
assert.strictEqual(qualityModuleFromKey('P2P-9'), 'P2P');
assert.strictEqual(qualityModuleFromKey('no-key'), 'Other');

assert.deepStrictEqual(
  jiraProjectsFromJql('project in (NFS, GL, FCO, FAA, INC, P2P) AND issuetype in (Bug) AND status not in (QA, PQA, "Pending DEP", "EOA Pending", Closed, Done, Resolved, Cancelled, "Won\'t Fix") ORDER BY priority DESC, created DESC'),
  ['NFS', 'GL', 'FCO', 'FAA', 'INC', 'P2P']
);
assert.deepStrictEqual(jiraProjectsFromJql('project = NFS AND issuetype = Bug'), ['NFS']);
assert.deepStrictEqual(jiraProjectsFromJql('project in (NFS) AND issuetype in ("R&D Pre-GoLive Bug")'), ['NFS']);
assert.deepStrictEqual(jiraProjectsFromJql(''), []);

assert.strictEqual(classifyQualityFixVersion(['N2027.R1'], 'N2027.R1', ['N2027.R1.01']), 'Market only');
assert.strictEqual(classifyQualityFixVersion(['N2027.R1.01'], 'N2027.R1', ['N2027.R1.01']), 'Patch only');
assert.strictEqual(classifyQualityFixVersion(['N2027.R1', 'N2027.R1.01'], 'N2027.R1', ['N2027.R1.01']), 'Market + patch');
assert.strictEqual(classifyQualityFixVersion(['N2026.R2'], 'N2027.R1', ['N2027.R1.01']), 'Other fixVersion');
assert.strictEqual(classifyQualityFixVersion([], 'N2027.R1', ['N2027.R1.01']), 'No fixVersion');

assert.strictEqual(countQualityBounces({
  changelog: { histories: [
    { items: [{ toString: 'Rejected' }] },
    { items: [{ toString: 'Dev Developing' }] },
    { items: [{ toString: 'Replied' }] },
  ] },
}), 2);
assert.strictEqual(countQualityBounces({ changelog: { histories: [] } }), 0);

const bugsJql = 'project in (NFS, GL) AND issuetype = Bug AND status not in (QA, PQA, Closed) ORDER BY priority';
assert.strictEqual(qualityJqlHidesLifecycle(bugsJql), true);
assert.strictEqual(qualityJqlHidesLifecycle('project = NFS AND issuetype in (Enhancement, Epic)'), false);

const patchRows = buildQualityPatchBreakdown([
  { fixVersions: ['N2027.R1'], severe: false },
  { fixVersions: ['N2027.R1.01'], severe: true },
  { fixVersions: ['N2027.R1', 'N2027.R1.01'], severe: true },
  { fixVersions: [], severe: false },
], 'N2027.R1', ['N2027.R1.01', 'N2027.R1.02']);
assert.strictEqual(patchRows.find(r => r.label === 'N2027.R1').open, 2);
assert.strictEqual(patchRows.find(r => r.label === 'N2027.R1.01').open, 2);
assert.strictEqual(patchRows.find(r => r.label === 'N2027.R1.01').blockers, 2);
assert.strictEqual(patchRows.find(r => r.label === 'N2027.R1.02').open, 0);
assert.strictEqual(patchRows.find(r => r.kind === 'other').open, 1);

console.log('quality-insights: ok');
