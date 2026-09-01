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

function injectFixVersionIntoJql(jql, releases) {
  const clause = buildFixVersionClause(releases);
  if (!clause || jql.toLowerCase().includes('fixversion')) return jql;
  const orderByMatch = jql.match(/\s+ORDER\s+BY\s+/i);
  if (orderByMatch) {
    const insertPos = orderByMatch.index;
    return jql.substring(0, insertPos) + ` AND ${clause}` + jql.substring(insertPos);
  }
  return jql + ` AND ${clause}`;
}

function stripFixVersionFromJql(jql) {
  return jql
    .replace(/\s+AND\s+fixVersion\s+in\s*\([^)]*\)/gi, '')
    .replace(/\s+AND\s+fixVersion\s*=\s*(?:"[^"]*"|[^\s]+)/gi, '')
    .replace(/^\s*fixVersion\s+in\s*\([^)]*\)\s*(?:AND\s+)?/gi, '')
    .replace(/^\s*fixVersion\s*=\s*(?:"[^"]*"|[^\s]+)\s*(?:AND\s+)?/gi, '')
    .trim();
}

function getEffectiveProjectJql(jql, activeRelease, excludeRelease) {
  if (!activeRelease || excludeRelease) return jql;
  return injectFixVersionIntoJql(stripFixVersionFromJql(jql), [activeRelease]);
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

assert.ok(!getEffectiveProjectJql(stored, 'N2027.R1').toLowerCase().includes('n2026.r2'));

console.log('fix-version-jql: ok');
