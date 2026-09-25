/**
 * Unit tests for fixVersion JQL rewrite used by the global release selector.
 * Run: node scripts/test-fix-version-jql.js
 */

'use strict';

const assert = require('assert');

function formatFixVersionValue(name) {
  if (/[\s(),]/.test(name)) return `"${name.replace(/"/g, '\\"')}"`;
  return name;
}

function buildFixVersionClause(releases) {
  if (!releases || releases.length === 0) return '';
  const formatted = releases.map(formatFixVersionValue);
  if (releases.length === 1) return `fixVersion = ${formatted[0]}`;
  return `fixVersion in (${formatted.join(', ')})`;
}

function stripFixVersionFromJql(jql) {
  let out = String(jql || '');
  [
    /\s+AND\s+\(\s*fixVersion\s+not\s+in\s*\([^)]*\)\s+AND\s+fixVersion\s+is\s+not\s+EMPTY\s*\)/gi,
    /\s+AND\s+fixVersion\s+is\s+not\s+EMPTY/gi,
    /\s+AND\s+fixVersion\s+is\s+EMPTY/gi,
    /\s+AND\s+fixVersion\s+not\s+in\s*\([^)]*\)/gi,
    /\s+AND\s+fixVersion\s+in\s*\([^)]*\)/gi,
    /\s+AND\s+fixVersion\s*=\s*(?:"[^"]*"|[^\s]+)/gi,
    /^\s*\(\s*fixVersion\s+not\s+in\s*\([^)]*\)\s+AND\s+fixVersion\s+is\s+not\s+EMPTY\s*\)\s*(?:AND\s+)?/gi,
    /^\s*fixVersion\s+is\s+not\s+EMPTY\s*(?:AND\s+)?/gi,
    /^\s*fixVersion\s+is\s+EMPTY\s*(?:AND\s+)?/gi,
    /^\s*fixVersion\s+not\s+in\s*\([^)]*\)\s*(?:AND\s+)?/gi,
    /^\s*fixVersion\s+in\s*\([^)]*\)\s*(?:AND\s+)?/gi,
    /^\s*fixVersion\s*=\s*(?:"[^"]*"|[^\s]+)\s*(?:AND\s+)?/gi,
  ].forEach(re => { out = out.replace(re, ' '); });
  return out.replace(/\s+/g, ' ').trim();
}

function injectJqlClause(jql, clause) {
  if (!clause) return jql;
  const orderByMatch = jql.match(/\s+ORDER\s+BY\s+/i);
  if (orderByMatch) {
    const insertPos = orderByMatch.index;
    return jql.substring(0, insertPos) + ` AND ${clause}` + jql.substring(insertPos);
  }
  return jql + ` AND ${clause}`;
}

function injectFixVersionIntoJql(jql, releases) {
  const clause = buildFixVersionClause(releases);
  if (!clause || jql.toLowerCase().includes('fixversion')) return jql;
  return injectJqlClause(jql, clause);
}

function uniqueReleaseNames(names) {
  const seen = new Set();
  const out = [];
  (names || []).forEach(name => {
    const value = String(name || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function normalizeReleaseMode(mode) {
  if (mode === 'patch' || mode === 'market+patch' || mode === 'market') return mode;
  return 'market';
}

function expandFixVersionsForMode(marketReleaseName, mode, patches) {
  const name = String(marketReleaseName || '').trim();
  if (!name) return [];
  const patchNames = uniqueReleaseNames(patches);
  const resolved = normalizeReleaseMode(mode);
  if (resolved === 'patch') return patchNames;
  if (resolved === 'market+patch') return uniqueReleaseNames([name, ...patchNames]);
  return [name];
}

function getEffectiveProjectJql(jql, activeRelease, excludeRelease, versions) {
  if (!activeRelease || excludeRelease) return jql;
  const resolved = versions || [activeRelease];
  const stripped = stripFixVersionFromJql(jql);
  if (!resolved.length) return injectJqlClause(stripped, 'key is EMPTY');
  return injectFixVersionIntoJql(stripped, resolved);
}

function getIssueFixVersionNames(issue) {
  const versions = issue && issue.fields && issue.fields.fixVersions;
  if (!Array.isArray(versions)) return [];
  return versions.map(v => (typeof v === 'string' ? v : (v && v.name) || '')).filter(Boolean);
}

function filterIssuesToAllowedVersions(issues, allowedNames) {
  const allowed = new Set(allowedNames || []);
  const kept = [];
  let mismatched = 0;
  (issues || []).forEach(issue => {
    const names = getIssueFixVersionNames(issue);
    if (!names.length || names.some(name => allowed.has(name))) kept.push(issue);
    else mismatched++;
  });
  return { issues: kept, mismatched };
}

const stored = 'project in (NFS) AND issuetype in (Enhancement, Epic) AND fixVersion in (N2027.R1, N2026.R2) ORDER BY "Scope Commitment At SC", status DESC, Priority DESC';
assert.strictEqual(
  getEffectiveProjectJql(stored, 'N2027.R1'),
  'project in (NFS) AND issuetype in (Enhancement, Epic) AND fixVersion = N2027.R1 ORDER BY "Scope Commitment At SC", status DESC, Priority DESC'
);
assert.strictEqual(
  getEffectiveProjectJql(stored, 'N2026.R2'),
  'project in (NFS) AND issuetype in (Enhancement, Epic) AND fixVersion = N2026.R2 ORDER BY "Scope Commitment At SC", status DESC, Priority DESC'
);

const noAnd = 'fixVersion in (N2027.R1, N2026.R2) AND project in (NFS)';
assert.strictEqual(getEffectiveProjectJql(noAnd, 'N2027.R1'), 'project in (NFS) AND fixVersion = N2027.R1');

const quoted = 'project = NFS AND fixVersion = "N 2027 R1" ORDER BY created';
assert.strictEqual(getEffectiveProjectJql(quoted, 'N2026.R2'), 'project = NFS AND fixVersion = N2026.R2 ORDER BY created');

const blankJql = injectJqlClause(stripFixVersionFromJql(stored), 'fixVersion is EMPTY');
assert.ok(blankJql.includes('fixVersion is EMPTY'));
assert.ok(!blankJql.toLowerCase().includes('n2027.r1'));
const unplannedJql = injectJqlClause(stripFixVersionFromJql(stored), 'fixVersion = UnPlanned');
assert.ok(unplannedJql.includes('fixVersion = UnPlanned'));
assert.ok(!unplannedJql.includes('not in'));

const combined = injectJqlClause(
  stripFixVersionFromJql(stored),
  '(' + buildFixVersionClause(['UnPlanned', 'N2027.R1', 'N2027.R1.01', 'N2026.R2']) + ' OR fixVersion is EMPTY)'
);
assert.ok(combined.includes('fixVersion in (UnPlanned, N2027.R1, N2027.R1.01, N2026.R2)'));
assert.ok(combined.includes('OR fixVersion is EMPTY'));
assert.ok(!combined.includes('not in'));
assert.ok(combined.includes('ORDER BY'));

assert.ok(!getEffectiveProjectJql(stored, 'N2027.R1').toLowerCase().includes('n2026.r2'));

const patches = ['N2026.R2.P1', 'N2026.R2.P2', ' N2026.R2.P1 ', ''];
assert.deepStrictEqual(expandFixVersionsForMode('N2026.R2', 'market', patches), ['N2026.R2']);
assert.deepStrictEqual(expandFixVersionsForMode('N2026.R2', 'patch', patches), ['N2026.R2.P1', 'N2026.R2.P2']);
assert.deepStrictEqual(
  expandFixVersionsForMode('N2026.R2', 'market+patch', patches),
  ['N2026.R2', 'N2026.R2.P1', 'N2026.R2.P2']
);
assert.deepStrictEqual(expandFixVersionsForMode('N2026.R2', 'patch', []), []);
assert.deepStrictEqual(expandFixVersionsForMode('N2026.R2', 'unknown', patches), ['N2026.R2']);

assert.strictEqual(
  getEffectiveProjectJql(stored, 'N2026.R2', false, expandFixVersionsForMode('N2026.R2', 'market+patch', patches)),
  'project in (NFS) AND issuetype in (Enhancement, Epic) AND fixVersion in (N2026.R2, N2026.R2.P1, N2026.R2.P2) ORDER BY "Scope Commitment At SC", status DESC, Priority DESC'
);
assert.strictEqual(
  getEffectiveProjectJql(stored, 'N2026.R2', false, expandFixVersionsForMode('N2026.R2', 'patch', patches)),
  'project in (NFS) AND issuetype in (Enhancement, Epic) AND fixVersion in (N2026.R2.P1, N2026.R2.P2) ORDER BY "Scope Commitment At SC", status DESC, Priority DESC'
);
assert.strictEqual(
  getEffectiveProjectJql(stored, 'N2026.R2', false, []),
  'project in (NFS) AND issuetype in (Enhancement, Epic) AND key is EMPTY ORDER BY "Scope Commitment At SC", status DESC, Priority DESC'
);

const cached = [
  { key: 'NFS-1', fields: { fixVersions: [{ name: 'N2026.R2' }] } },
  { key: 'NFS-2', fields: { fixVersions: [{ name: 'N2026.R2.P1' }] } },
  { key: 'NFS-3', fields: { fixVersions: [{ name: 'N2027.R1' }] } },
  { key: 'NFS-4', fields: { fixVersions: [] } },
];
const marketOnly = filterIssuesToAllowedVersions(cached, ['N2026.R2']);
assert.deepStrictEqual(marketOnly.issues.map(i => i.key), ['NFS-1', 'NFS-4']);
assert.strictEqual(marketOnly.mismatched, 2);
const withPatches = filterIssuesToAllowedVersions(cached, ['N2026.R2', 'N2026.R2.P1', 'N2026.R2.P2']);
assert.deepStrictEqual(withPatches.issues.map(i => i.key), ['NFS-1', 'NFS-2', 'NFS-4']);
assert.strictEqual(withPatches.mismatched, 1);
const patchesOnly = filterIssuesToAllowedVersions(cached, ['N2026.R2.P1', 'N2026.R2.P2']);
assert.deepStrictEqual(patchesOnly.issues.map(i => i.key), ['NFS-2', 'NFS-4']);
assert.strictEqual(patchesOnly.mismatched, 2);

function getProjectSyncSkipReasonForTest(proj, releaseName, assigned, mode, patches) {
  if (!proj) return 'unknown-project';
  if (proj.excludeRelease) return '';
  if (!releaseName) return 'not-enabled';
  if (!(assigned || []).includes(releaseName)) return 'not-enabled';
  if (!expandFixVersionsForMode(releaseName, mode, patches).length) return 'no-versions';
  return '';
}

function buildConnectorSyncJobsForTest(releases, projects) {
  const jobs = [];
  releases.forEach(release => {
    projects.forEach(project => {
      jobs.push({
        release,
        key: project.key,
        skipReason: getProjectSyncSkipReasonForTest(
          project,
          release,
          project.assigned,
          project.mode,
          project.patches
        ) || '',
      });
    });
  });
  return jobs;
}

assert.strictEqual(getProjectSyncSkipReasonForTest({ key: 'NFS' }, 'N2026.R1', ['N2026.R2'], 'market', []), 'not-enabled');
assert.strictEqual(getProjectSyncSkipReasonForTest({ key: 'NFS' }, 'N2026.R2', ['N2026.R2'], 'market', []), '');
assert.strictEqual(getProjectSyncSkipReasonForTest({ key: 'NFS' }, 'N2026.R2', ['N2026.R2'], 'patch', []), 'no-versions');
assert.strictEqual(getProjectSyncSkipReasonForTest({ key: 'NFS' }, 'N2026.R2', ['N2026.R2'], 'patch', ['N2026.R2.P1']), '');
assert.strictEqual(getProjectSyncSkipReasonForTest({ key: 'BUGS', excludeRelease: true }, 'N2026.R2', [], 'market', []), '');

const connectorJobs = buildConnectorSyncJobsForTest(
  ['N2026.R1', 'N2026.R2'],
  [
    { key: 'NFS', assigned: ['N2026.R2'], mode: 'market+patch', patches: ['N2026.R2.P1'] },
    { key: 'GL', assigned: ['N2026.R1', 'N2026.R2'], mode: 'market', patches: [] },
    { key: 'BUGS', excludeRelease: true, assigned: [], mode: 'market', patches: [] },
  ]
);
assert.deepStrictEqual(connectorJobs.map(j => `${j.release}:${j.key}:${j.skipReason || 'fetch'}`), [
  'N2026.R1:NFS:not-enabled',
  'N2026.R1:GL:fetch',
  'N2026.R1:BUGS:fetch',
  'N2026.R2:NFS:fetch',
  'N2026.R2:GL:fetch',
  'N2026.R2:BUGS:fetch',
]);

function projectIgnoresReleaseFilter(proj, assigned) {
  if (!proj || !proj.excludeRelease) return false;
  return !(assigned || []).length;
}

assert.strictEqual(projectIgnoresReleaseFilter({ excludeRelease: true }, []), true);
assert.strictEqual(projectIgnoresReleaseFilter({ excludeRelease: true }, ['N2026.R2']), false);
assert.strictEqual(projectIgnoresReleaseFilter({ excludeRelease: false }, []), false);

const bugsJql = 'project in (NFS) AND issuetype = Bug AND fixVersion = N2026.R2 ORDER BY priority DESC';
const n2027Patches = ['N2027.R1.01', 'N2027.R1.02', 'N2027.R1.03'];
assert.strictEqual(
  getEffectiveProjectJql(bugsJql, 'N2027.R1', false, expandFixVersionsForMode('N2027.R1', 'market+patch', n2027Patches)),
  'project in (NFS) AND issuetype = Bug AND fixVersion in (N2027.R1, N2027.R1.01, N2027.R1.02, N2027.R1.03) ORDER BY priority DESC'
);
assert.strictEqual(
  getEffectiveProjectJql(bugsJql, 'N2026.R2', false, expandFixVersionsForMode('N2026.R2', 'market+patch', [])),
  'project in (NFS) AND issuetype = Bug AND fixVersion = N2026.R2 ORDER BY priority DESC'
);

console.log('fix-version-jql: ok');
