/**
 * A + Clarity dashboard aggregation.
 * Run: node scripts/test-clarity-dashboard.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Clarity = require('../lib/clarity-dashboard');
const { normalizeMenuGroups, defaultMenuGroups } = require('../lib/menu');

const rows = [
  { key: 'NFS-1', summary: 'Ship the ledger', projectKey: 'NFS', projectName: 'Lease', scope: 'Committed', scopeAtSc: 'Committed', phase: 'Developing', priority: 'High', type: 'Enhancement', clarity: '🟢', closed: false },
  { key: 'NFS-2', summary: 'Waiting on design', projectKey: 'NFS', projectName: 'Lease', scope: 'Opportunistic', scopeAtSc: 'Not set', phase: 'Product', priority: 'Medium', type: 'Enhancement', clarity: '🟡', closed: false },
  { key: 'GL-1', summary: 'Blocked posting', projectKey: 'GL', projectName: 'Ledger', scope: 'Committed', scopeAtSc: 'Not set', phase: 'Developing', priority: 'High', type: 'Epic', clarity: '🔴', closed: false },
  { key: 'FAA-9', summary: 'Old asset work', projectKey: 'FAA', projectName: 'Assets', scope: 'Not set', scopeAtSc: 'Not set', phase: 'Closed', priority: 'Low', type: 'Enhancement', clarity: '⚪', closed: true },
  { key: 'P2P-3', summary: 'Missing rating', projectKey: 'P2P', projectName: 'Payables', scope: 'Request To Commit', scopeAtSc: 'Opportunistic', phase: 'QA', priority: 'High', type: 'Enhancement', clarity: 'Not set', closed: false },
];

assert.strictEqual(Clarity.clarityLabel({ value: '🟢' }), '🟢');
assert.strictEqual(Clarity.clarityLabel(''), 'Not set');
assert.strictEqual(Clarity.clarityLabel(null), 'Not set');

const all = Clarity.applyFilters(rows, {});
assert.strictEqual(all.length, 5);

const committed = Clarity.applyFilters(rows, { scope: ['Committed'] });
assert.deepStrictEqual(committed.map(row => row.key), ['NFS-1', 'GL-1']);

const nfsOpen = Clarity.applyFilters(rows, { project: new Set(['NFS']), openOnly: true });
assert.deepStrictEqual(nfsOpen.map(row => row.key), ['NFS-1', 'NFS-2']);

const found = Clarity.applyFilters(rows, { q: 'ledger' });
assert.deepStrictEqual(found.map(row => row.key), ['NFS-1', 'GL-1']);

const redHigh = Clarity.applyFilters(rows, { clarity: ['🔴'], priority: ['High'], phase: ['Developing'] });
assert.deepStrictEqual(redHigh.map(row => row.key), ['GL-1']);

const matrix = Clarity.crossTab(rows, { rowOrder: ['NFS', 'GL', 'FAA', 'P2P'], columnOrder: Clarity.SCOPE_ORDER });
assert.deepStrictEqual(matrix.columns, ['Committed', 'Request To Commit', 'Opportunistic', 'Not set']);
assert.deepStrictEqual(matrix.rows.map(row => row.key), ['NFS', 'GL', 'FAA', 'P2P']);
assert.strictEqual(matrix.rows[0].cells.Committed.total, 1);
assert.strictEqual(matrix.rows[0].cells.Committed.counts['🟢'], 1);
assert.strictEqual(matrix.rows[1].cells.Committed.counts['🔴'], 1);
assert.ok(!matrix.rows[2].cells.Committed);

const summary = Clarity.summarize(rows, { projectOrder: ['P2P', 'NFS', 'GL', 'FAA'] });
assert.strictEqual(summary.total, 5);
assert.deepStrictEqual(summary.clarityLabels, ['🟢', '🟡', '🔴', '⚪', 'Not set']);
assert.deepStrictEqual(summary.byProject.map(group => group.key), ['P2P', 'NFS', 'GL', 'FAA']);
assert.strictEqual(summary.byProject[1].counts['🟢'], 1);
assert.strictEqual(summary.byProject[1].total, 2);
assert.deepStrictEqual(summary.byScope.map(group => group.key), ['Committed', 'Request To Commit', 'Opportunistic', 'Not set']);

const series = Clarity.stacked(summary.byScope, summary.clarityLabels);
assert.strictEqual(series.length, 5);
assert.deepStrictEqual(series[0].data, [1, 0, 0, 0]);
assert.strictEqual(series[0].color, '#3B6D11');

assert.ok(Clarity.trackRank('🔴') < Clarity.trackRank('Not set'));
assert.ok(Clarity.trackRank('Not set') < Clarity.trackRank('⚪'));
assert.ok(Clarity.trackRank('🟡') < Clarity.trackRank('🟢'));
assert.strictEqual(Clarity.clarityColor('🟢'), '#3B6D11');
assert.strictEqual(Clarity.clarityColor('⚪'), '#A8A29E');
assert.strictEqual(Clarity.clarityColor('⚪\uFE0F'), '#A8A29E');
assert.strictEqual(Clarity.clarityCaption('🟢'), 'Green');
assert.strictEqual(Clarity.clarityCaption('⚪\uFE0F'), 'White');
assert.strictEqual(Clarity.clarityCaption('Not set'), 'Not set');
assert.strictEqual(Clarity.clarityCaption('Custom'), 'Custom');
assert.ok(Clarity.clarityColor('Custom'));

const defaults = defaultMenuGroups();
assert.ok(!defaults[0].pages.includes('clarity'));
const dropped = normalizeMenuGroups([
  { id: 'delivery', label: 'Delivery', catchAll: true, pages: ['analytics', 'clarity', 'nope'] },
]);
assert.deepStrictEqual(dropped[0].pages, ['analytics']);

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
const menuSrc = fs.readFileSync(path.join(root, 'lib', 'menu.js'), 'utf8');
const standalone = fs.readFileSync(path.join(root, 'scripts', 'build-standalone.js'), 'utf8');
assert.ok(!dashboard.includes('id="page-clarity"'));
assert.ok(!dashboard.includes('function analyticsClarityMatrixHtml('));
assert.ok(!dashboard.includes('class="clarity-matrix"'));
assert.ok(dashboard.includes('function analyticsClarityChartHtml('));
assert.ok(dashboard.includes('function drawAnalyticsClarityChart('));
assert.ok(dashboard.includes('function openProjectFromClarityCell('));
assert.ok(dashboard.includes('id="c_clarity"'));
assert.ok(dashboard.includes('data-clarity-scope-pick'));
assert.ok(dashboard.includes('S.clarityScopes'));
assert.ok(dashboard.includes('function analyticsClarityNumbersHtml('));
assert.ok(dashboard.includes('data-clarity-count'));
assert.ok(dashboard.includes("setAnalyticsView('clarity'"));
assert.ok(dashboard.includes('/lib/clarity-dashboard.js'));
assert.ok(!menuSrc.includes("{ id: 'clarity'"));
assert.ok(proxy.includes("'/lib/clarity-dashboard.js'"));
assert.ok(standalone.includes('clarity-dashboard.js'));

console.log('clarity-dashboard: ok');
