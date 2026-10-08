/**
 * Unit tests for per-user project sort preferences.
 * Run: node scripts/test-user-preferences.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUserPreferences, normalizeSortLevels } = require('../lib/user-preferences');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-prefs-'));
const filePath = path.join(tmpDir, 'user-preferences.json');
const prefs = createUserPreferences({ filePath });

assert.deepStrictEqual(prefs.get('user-a'), { version: 1, projectSorts: {} });

const saved = prefs.setProjectSort('user-a', 'NFS', [
  { col: 'priority', dir: 'asc' },
  { col: 'status', dir: 'desc' },
  { col: 'key', dir: -1 },
]);
assert.deepStrictEqual(saved.levels, [
  { col: 'priority', dir: 1 },
  { col: 'status', dir: -1 },
  { col: 'key', dir: -1 },
]);
assert.deepStrictEqual(prefs.get('user-a').projectSorts.NFS, saved.levels);
assert.deepStrictEqual(prefs.get('user-b').projectSorts, {});

prefs.setProjectSort('user-b', 'QA', [{ col: 'summary', dir: 1 }]);
assert.deepStrictEqual(Object.keys(prefs.get('user-a').projectSorts), ['NFS']);
assert.deepStrictEqual(Object.keys(prefs.get('user-b').projectSorts), ['QA']);

const cleared = prefs.setProjectSort('user-a', 'NFS', []);
assert.deepStrictEqual(cleared.levels, []);
assert.deepStrictEqual(prefs.get('user-a').projectSorts, {});

const reloaded = createUserPreferences({ filePath });
assert.deepStrictEqual(reloaded.get('user-b').projectSorts.QA, [{ col: 'summary', dir: 1 }]);

assert.throws(() => prefs.setProjectSort('user-a', 'NFS', [
  { col: 'priority', dir: 1 },
  { col: 'priority', dir: -1 },
]), /only be used once/);
assert.throws(() => prefs.setProjectSort('user-a', 'NFS', [
  { col: 'nope field', dir: 1 },
]), /Choose a column/);
assert.throws(() => prefs.setProjectSort('user-a', '../etc', [{ col: 'key', dir: 1 }]), /Unknown project/);
assert.throws(() => normalizeSortLevels(Array.from({ length: 9 }, (_, i) => ({ col: 'c' + i, dir: 1 }))), /at most 8/);

const custom = prefs.setProjectSort('user-a', 'NFS', [
  { col: 'cf_scope', dir: 1, order: [' Stretch ', 'Committed', 'Stretch', 'Opportunistic'] },
]);
assert.deepStrictEqual(custom.levels, [
  { col: 'cf_scope', dir: 1, order: ['Stretch', 'Committed', 'Opportunistic'] },
]);
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').projectSorts.NFS[0].order, [
  'Stretch', 'Committed', 'Opportunistic',
]);
assert.throws(() => normalizeSortLevels([{ col: 'priority', dir: 1, order: 'High' }]), /list of values/);
assert.throws(() => normalizeSortLevels([{ col: 'priority', dir: 1, order: ['x'.repeat(121)] }]), /too long/);
assert.throws(
  () => normalizeSortLevels([{ col: 'priority', dir: 1, order: Array.from({ length: 25 }, (_, i) => 'v' + i) }]),
  /at most 24/
);

const corruptPath = path.join(tmpDir, 'corrupt.json');
fs.writeFileSync(corruptPath, '{', 'utf8');
assert.throws(() => createUserPreferences({ filePath: corruptPath }), /unreadable/);
assert.ok(fs.readdirSync(tmpDir).some(name => name.startsWith('corrupt.json.corrupt-')));

const dirtyPath = path.join(tmpDir, 'dirty.json');
fs.writeFileSync(dirtyPath, JSON.stringify({
  version: 1,
  users: { 'user-a': { projectSorts: { NFS: [{ col: 'key', dir: 1 }], broken: 'nope' } } },
}), 'utf8');
const dirty = createUserPreferences({ filePath: dirtyPath });
assert.deepStrictEqual(dirty.get('user-a').projectSorts, { NFS: [{ col: 'key', dir: 1 }] });

console.log('user preferences ok');
