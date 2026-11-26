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

assert.deepStrictEqual(prefs.get('user-a'), { version: 1, projectSorts: {}, groupByEpic: true, showBounced: true, hiddenPhases: [], columnWidths: {}, columnFreeze: {}, columnViews: {}, sortConfigs: {} });

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
assert.strictEqual(dirty.get('user-a').groupByEpic, true);

const groupedOff = prefs.setGroupByEpic('user-a', false);
assert.deepStrictEqual(groupedOff, { version: 1, groupByEpic: false });
assert.strictEqual(prefs.get('user-a').groupByEpic, false);
prefs.setProjectSort('user-a', 'NFS', [{ col: 'key', dir: 1 }]);
prefs.setProjectSort('user-a', 'NFS', []);
assert.strictEqual(prefs.get('user-a').groupByEpic, false);
assert.deepStrictEqual(prefs.get('user-a').projectSorts, {});
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').groupByEpic, false);

prefs.setGroupByEpic('user-a', true);
assert.deepStrictEqual(prefs.get('user-a'), { version: 1, projectSorts: {}, groupByEpic: true, showBounced: true, hiddenPhases: [], columnWidths: {}, columnFreeze: {}, columnViews: {}, sortConfigs: {} });
assert.throws(() => prefs.setGroupByEpic('user-a', 'no'), /on or off/);

const hiddenBounced = prefs.setShowBounced('user-a', false);
assert.deepStrictEqual(hiddenBounced, { version: 1, showBounced: false });
assert.strictEqual(prefs.get('user-a').showBounced, false);
assert.deepStrictEqual(prefs.get('user-a').hiddenPhases, ['Rejected / Replied']);
assert.strictEqual(createUserPreferences({ filePath }).get('user-a').showBounced, false);
prefs.setShowBounced('user-a', true);
assert.strictEqual(prefs.get('user-a').showBounced, true);
assert.deepStrictEqual(prefs.get('user-a').hiddenPhases, []);
assert.deepStrictEqual(prefs.get('user-a').projectSorts, {});
assert.throws(() => prefs.setShowBounced('user-a', 'no'), /on or off/);

const qaHidden = prefs.setPhaseVisibility('user-a', 'QA', false);
assert.deepStrictEqual(qaHidden.hiddenPhases, ['QA']);
assert.strictEqual(qaHidden.enabled, false);
const bothHidden = prefs.setPhaseVisibility('user-a', 'Rejected / Replied', false);
assert.deepStrictEqual(bothHidden.hiddenPhases, ['QA', 'Rejected / Replied']);
assert.strictEqual(bothHidden.showBounced, false);
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').hiddenPhases, ['QA', 'Rejected / Replied']);
const qaShown = prefs.setPhaseVisibility('user-a', 'QA', true);
assert.deepStrictEqual(qaShown.hiddenPhases, ['Rejected / Replied']);
prefs.setPhaseVisibility('user-a', 'Rejected / Replied', true);
assert.deepStrictEqual(prefs.get('user-a').hiddenPhases, []);
assert.throws(() => prefs.setPhaseVisibility('user-a', 'Total', false), /status card/);
assert.throws(() => prefs.setPhaseVisibility('user-a', 'QA', 'no'), /on or off/);

const legacyPath = path.join(tmpDir, 'legacy-bounced.json');
fs.writeFileSync(legacyPath, JSON.stringify({
  version: 1,
  users: { 'user-a': { showBounced: false, projectSorts: {} } },
}), 'utf8');
const legacy = createUserPreferences({ filePath: legacyPath });
assert.deepStrictEqual(legacy.get('user-a').hiddenPhases, ['Rejected / Replied']);
assert.strictEqual(legacy.get('user-a').showBounced, false);

const widths = prefs.setColumnWidths('user-a', 'NFS', { summary: 280.4, notes: 88, 'nope field': 100 });
assert.deepStrictEqual(widths.widths, { summary: 280, notes: 88 });
assert.deepStrictEqual(prefs.get('user-a').columnWidths.NFS, { summary: 280, notes: 88 });
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').columnWidths.NFS, { summary: 280, notes: 88 });
assert.throws(() => prefs.setColumnWidths('user-a', 'NFS', { summary: 10 }), /between/);
assert.throws(() => prefs.setColumnWidths('user-a', 'NFS', []), /object/);
assert.deepStrictEqual(prefs.setColumnWidths('user-a', 'NFS', {}).widths, {});
assert.deepStrictEqual(prefs.get('user-a').columnWidths, {});

assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', 'summary'), { version: 1, projectKey: 'NFS', freeze: 'summary' });
assert.deepStrictEqual(prefs.get('user-a').columnFreeze, { NFS: 'summary' });
assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', { start: 'key', end: 'status' }), {
  version: 1,
  projectKey: 'NFS',
  freeze: { start: 'key', end: 'status' },
});
assert.deepStrictEqual(prefs.get('user-a').columnFreeze, { NFS: { start: 'key', end: 'status' } });
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').columnFreeze, { NFS: { start: 'key', end: 'status' } });
assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', 'none'), { version: 1, projectKey: 'NFS', freeze: 'none' });
assert.strictEqual(prefs.get('user-a').columnFreeze.NFS, 'none');
assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', 'notes').freeze, 'notes');
assert.deepStrictEqual(prefs.get('user-a').columnFreeze, {});
assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', '').freeze, 'notes');
assert.deepStrictEqual(prefs.setColumnFreeze('user-a', 'NFS', { start: 'notes', end: 'notes' }).freeze, 'notes');
assert.throws(() => prefs.setColumnFreeze('user-a', 'NFS', 'has space'), /column to freeze/);
assert.throws(() => prefs.setColumnFreeze('user-a', 'NFS', { start: 'key', end: 'bad col' }), /column to freeze/);
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').columnFreeze, {});

const triage = prefs.setColumnViews('user-a', 'NFS', {
  active: 'triage',
  order: ['summary', 'notes', 'key'],
  views: [{ id: 'Triage', name: '  Triage  ', columns: ['key', 'key', 'summary', 'notes'] }],
});
assert.deepStrictEqual(triage.columnViews, {
  active: 'triage',
  order: ['summary', 'key'],
  views: [{ id: 'triage', name: 'Triage', columns: ['key', 'summary'] }],
});
assert.deepStrictEqual(prefs.get('user-a').columnViews.NFS.views[0].columns, ['key', 'summary']);
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').columnViews.NFS.views[0].name, 'Triage');
const withFreeze = prefs.setColumnViews('user-a', 'NFS', {
  active: 'triage',
  order: [],
  freeze: { start: 'key', end: 'status' },
  views: [{ id: 'triage', name: 'Triage', columns: ['key', 'summary'], freeze: 'none' }],
});
assert.deepStrictEqual(withFreeze.columnViews.freeze, { start: 'key', end: 'status' });
assert.strictEqual(withFreeze.columnViews.views[0].freeze, 'none');
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').columnViews.NFS.freeze, { start: 'key', end: 'status' });
assert.deepStrictEqual(prefs.setColumnViews('user-a', 'NFS', {
  active: 'default',
  order: [],
  views: [],
  freeze: 'none',
}).columnViews, { active: 'default', order: [], views: [], freeze: 'none' });
assert.throws(() => prefs.setColumnViews('user-a', 'NFS', {
  views: [{ id: 'bad', name: 'Bad', columns: ['key'], freeze: 'has space' }],
}), /column to freeze/);
assert.throws(() => prefs.setColumnViews('user-a', 'NFS', {
  views: [
    { id: 'a', name: 'One', columns: ['key'] },
    { id: 'b', name: 'one', columns: ['summary'] },
  ],
}), /already uses that name/);
assert.throws(() => prefs.setColumnViews('user-a', 'NFS', {
  views: [{ id: 'empty', name: 'Empty', columns: ['notes'] }],
}), /at least one column/);
assert.deepStrictEqual(prefs.setColumnViews('user-a', 'NFS', null).columnViews, { active: 'default', order: [], views: [] });
assert.deepStrictEqual(prefs.get('user-a').columnViews, {});

const scopeSort = prefs.setSortConfigs('user-a', 'Core Modules', [
  { id: 'Scope-first', name: '  Scope first  ', levels: [{ col: 'cf_scope', dir: 'asc', order: ['Committed', 'Committed'] }] },
]);
assert.strictEqual(scopeSort.category, 'Core Modules');
assert.deepStrictEqual(scopeSort.configs, [{
  id: 'scope-first',
  name: 'Scope first',
  levels: [{ col: 'cf_scope', dir: 1, order: ['Committed'] }],
}]);
assert.deepStrictEqual(prefs.get('user-a').sortConfigs['Core Modules'][0].name, 'Scope first');
assert.deepStrictEqual(createUserPreferences({ filePath }).get('user-a').sortConfigs['Core Modules'][0].levels[0].col, 'cf_scope');
prefs.setSortConfigs('user-a', 'Infrastructure', [
  { id: 'priority', name: 'Priority', levels: [{ col: 'priority', dir: -1 }] },
]);
assert.deepStrictEqual(Object.keys(prefs.get('user-a').sortConfigs).sort(), ['Core Modules', 'Infrastructure']);
assert.deepStrictEqual(prefs.get('user-b').sortConfigs, {});
const withDefault = prefs.setSortConfigs('user-a', 'Core Modules', [
  { id: 'scope-first', name: 'Scope first', levels: [{ col: 'cf_scope', dir: 1 }], default: true },
  { id: 'priority', name: 'Priority', levels: [{ col: 'priority', dir: -1 }] },
]);
assert.strictEqual(withDefault.configs[0].default, true);
assert.strictEqual(withDefault.configs[1].default, undefined);
assert.throws(() => prefs.setSortConfigs('user-a', 'Core Modules', [
  { id: 'a', name: 'One', levels: [{ col: 'key', dir: 1 }], default: true },
  { id: 'b', name: 'Two', levels: [{ col: 'summary', dir: 1 }], default: true },
]), /Only one saved sort can be the default/);
const noneSort = prefs.setProjectSort('user-a', 'GL', [], { none: true });
assert.deepStrictEqual(noneSort.levels, []);
assert.strictEqual(noneSort.inherit, false);
assert.deepStrictEqual(prefs.get('user-a').projectSorts.GL, []);
const inherited = prefs.setProjectSort('user-a', 'GL', [], { inherit: true });
assert.strictEqual(inherited.inherit, true);
assert.strictEqual(prefs.get('user-a').projectSorts.GL, undefined);
assert.deepStrictEqual(prefs.setSortConfigs('user-a', 'Core Modules', []).configs, []);
assert.deepStrictEqual(prefs.get('user-a').sortConfigs['Core Modules'], undefined);
assert.throws(() => prefs.setSortConfigs('user-a', 'Core Modules', [
  { id: 'a', name: 'One', levels: [{ col: 'key', dir: 1 }] },
  { id: 'b', name: 'one', levels: [{ col: 'summary', dir: 1 }] },
]), /already uses that name/);
assert.throws(() => prefs.setSortConfigs('user-a', 'Core Modules', [
  { id: 'empty', name: 'Empty', levels: [] },
]), /at least one level/);
assert.throws(() => prefs.setSortConfigs('user-a', 'bad/name', []), /Unknown category/);

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(__dirname, '..', 'proxy.js'), 'utf8');
assert.ok(dashboard.includes('function saveProjectSortConfig'));
assert.ok(dashboard.includes('function setSavedSortDefault'));
assert.ok(dashboard.includes('function useCategoryDefaultSort'));
assert.ok(dashboard.includes('id="proj-sort-default"'));
assert.ok(dashboard.includes('function loadSavedProjectSort'));
assert.ok(dashboard.includes('sortConfigCategory'));
assert.ok(dashboard.includes('Using the category default.'));
assert.ok(proxy.includes("app.put('/api/user-preferences/sort-configs/:category'"));
assert.ok(dashboard.includes('function setPhaseVisibility'));
assert.ok(dashboard.includes('function issueHiddenFromListing'));
assert.ok(dashboard.includes('class="phase-visibility"'));
assert.ok(dashboard.includes('phaseTicketsShown(label)'));
assert.ok(proxy.includes("app.put('/api/user-preferences/phase-visibility'"));

console.log('user preferences ok');
