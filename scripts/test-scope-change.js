/**
 * Scope change: tickets added to or removed from a release.
 * Run: node scripts/test-scope-change.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ScopeChange = require('../lib/scope-change');
const Menu = require('../lib/menu');

const {
  isKeptChangelogItem,
  resolveEffort,
  collectScopeEvents,
  summarizeScopeChange,
  periodKey,
} = ScopeChange;

assert.strictEqual(isKeptChangelogItem({ field: 'status', fieldId: 'status' }), true);
assert.strictEqual(isKeptChangelogItem({ field: 'Fix Version', fieldId: 'fixVersions' }), true);
assert.strictEqual(isKeptChangelogItem({ field: 'description', fieldId: 'description' }), false);

assert.deepStrictEqual(resolveEffort(0, 5), { days: 0, source: 'actual' });
assert.deepStrictEqual(resolveEffort(null, 2.5), { days: 2.5, source: 'estimate' });
assert.deepStrictEqual(resolveEffort('', ''), { days: 0, source: 'missing' });

function issue(extra) {
  return Object.assign({
    key: 'NFS-1',
    fields: {
      created: '2026-11-01T15:00:00.000Z',
      summary: 'Add report',
      fixVersions: [{ name: 'N2026.R2' }],
    },
    changelog: { _includesFixVersions: true, histories: [] },
  }, extra);
}

const createdOnly = collectScopeEvents(issue(), {
  scopeNames: ['N2026.R2'],
  effort: { actual: null, estimate: 2 },
});
assert.strictEqual(createdOnly.length, 1);
assert.strictEqual(createdOnly[0].kind, 'added');
assert.strictEqual(createdOnly[0].initial, true);
assert.strictEqual(createdOnly[0].days, 2);
assert.strictEqual(createdOnly[0].source, 'estimate');
assert.deepStrictEqual(createdOnly[0].to, ['N2026.R2']);

const noHistory = collectScopeEvents(issue({
  changelog: { histories: [] },
}), { scopeNames: ['N2026.R2'], effort: { actual: 4, estimate: 2 } });
assert.deepStrictEqual(noHistory, []);

const movedIn = collectScopeEvents(issue({
  fields: {
    created: '2026-10-01T15:00:00.000Z',
    fixVersions: [{ name: 'N2026.R2' }],
  },
  changelog: {
    _includesFixVersions: true,
    histories: [{
      created: '2026-11-20T15:00:00.000Z',
      items: [{ field: 'Fix Version', fieldId: 'fixVersions', fromString: 'N2027.R1', toString: 'N2026.R2' }],
    }],
  },
}), { scopeNames: ['n2026.r2'], effort: { actual: 3, estimate: 9 } });
assert.strictEqual(movedIn.length, 1);
assert.strictEqual(movedIn[0].kind, 'added');
assert.strictEqual(movedIn[0].initial, false);
assert.strictEqual(movedIn[0].source, 'actual');
assert.strictEqual(movedIn[0].days, 3);

const addedThenRemoved = collectScopeEvents(issue({
  changelog: {
    _includesFixVersions: true,
    histories: [{
      created: '2026-11-20T15:00:00.000Z',
      items: [{
        field: 'Fix Version',
        fieldId: 'fixVersions',
        fromString: 'N2026.R2, N2026.R2.01',
        toString: 'N2027.R1',
      }],
    }],
  },
}), { scopeNames: ['N2026.R2', 'N2026.R2.01'], effort: { actual: 1, estimate: null } });
assert.strictEqual(addedThenRemoved.length, 2);
assert.strictEqual(addedThenRemoved[0].kind, 'added');
assert.strictEqual(addedThenRemoved[0].initial, true);
assert.strictEqual(addedThenRemoved[1].kind, 'removed');
assert.deepStrictEqual(addedThenRemoved[1].from, ['N2026.R2', 'N2026.R2.01']);
assert.deepStrictEqual(addedThenRemoved[1].to, ['N2027.R1']);

const stayed = collectScopeEvents(issue({
  changelog: {
    _includesFixVersions: true,
    histories: [{
      created: '2026-11-20T15:00:00.000Z',
      items: [{ field: 'Fix Version', fieldId: 'fixVersions', fromString: 'N2026.R2', toString: 'N2026.R2.01' }],
    }],
  },
}), { scopeNames: ['N2026.R2', 'N2026.R2.01'], effort: { actual: 1, estimate: null } });
assert.strictEqual(stayed.length, 1);
assert.strictEqual(stayed[0].initial, true);

const storedTransitionOnly = collectScopeEvents(issue({
  changelog: {
    histories: [{
      created: '2026-11-18T12:00:00.000Z',
      items: [{ field: 'Fix Version', fieldId: 'fixVersions', fromString: 'N2026.R2', toString: '' }],
    }],
  },
}), { scopeNames: ['N2026.R2'], effort: { actual: null, estimate: null } });
assert.strictEqual(storedTransitionOnly.length, 1);
assert.strictEqual(storedTransitionOnly[0].kind, 'removed');
assert.strictEqual(storedTransitionOnly[0].source, 'missing');
assert.deepStrictEqual(storedTransitionOnly[0].to, []);

const leftBlank = collectScopeEvents(issue({
  fields: {
    created: '2026-11-02T12:00:00.000Z',
    fixVersions: [{ name: 'N2026.R2' }],
  },
  changelog: {
    _includesFixVersions: true,
    histories: [{
      created: '2026-11-21T12:00:00.000Z',
      items: [{ field: 'Fix Version', fieldId: 'fixVersions', fromString: '', toString: 'N2026.R2' }],
    }],
  },
}), { scopeNames: [], blank: true, effort: { actual: null, estimate: 1 } });
assert.strictEqual(leftBlank.length, 2);
assert.strictEqual(leftBlank[0].kind, 'added');
assert.strictEqual(leftBlank[1].kind, 'removed');

const weekEvents = [
  { kind: 'added', time: new Date(2026, 10, 23, 9).getTime(), days: 1.5, source: 'actual' },
  { kind: 'removed', time: new Date(2026, 10, 23, 18).getTime(), days: 0.5, source: 'estimate' },
  { kind: 'added', time: new Date(2026, 9, 1, 9).getTime(), days: 9, source: 'actual' },
];
const weeks = summarizeScopeChange(weekEvents, {
  period: 'week',
  from: new Date(2026, 10, 1).getTime(),
  to: new Date(2026, 10, 30, 23, 59).getTime(),
});
assert.strictEqual(weeks.length, 1);
assert.strictEqual(weeks[0].addedCount, 1);
assert.strictEqual(weeks[0].removedCount, 1);
assert.strictEqual(weeks[0].addedDays, 1.5);
assert.strictEqual(weeks[0].removedDays, 0.5);
assert.strictEqual(weeks[0].key, periodKey(new Date(2026, 10, 23), 'week'));

const months = summarizeScopeChange(weekEvents, { period: 'month' });
assert.deepStrictEqual(months.map(row => row.key), ['2026-10', '2026-11']);
assert.strictEqual(months[1].addedCount, 1);
assert.strictEqual(months[1].removedCount, 1);

const filled = summarizeScopeChange(weekEvents, {
  period: 'week',
  from: new Date(2026, 10, 1).getTime(),
  to: new Date(2026, 10, 30, 23, 59).getTime(),
  fill: true,
});
assert.ok(filled.length > 1);
assert.strictEqual(filled[0].key, periodKey(new Date(2026, 10, 1), 'week'));
assert.strictEqual(filled[filled.length - 1].key, periodKey(new Date(2026, 10, 30), 'week'));
assert.ok(filled.some(row => row.addedCount === 0 && row.removedCount === 0));
assert.strictEqual(filled.reduce((sum, row) => sum + row.addedCount, 0), 1);

const sc = new Date(2026, 4, 14).getTime();
const ff = new Date(2026, 7, 24).getTime();
const spans = ScopeChange.summarizeBetweenMilestones([
  { kind: 'added', time: new Date(2026, 4, 13, 18).getTime(), days: 1 },
  { kind: 'added', time: new Date(2026, 4, 14, 8).getTime(), days: 2 },
  { kind: 'removed', time: new Date(2026, 7, 23, 12).getTime(), days: 3 },
  { kind: 'added', time: new Date(2026, 7, 24, 1).getTime(), days: 4 },
], [
  { id: 'SC', label: 'SC', time: sc },
  { id: 'FF', label: 'FF', time: ff },
]);
assert.strictEqual(spans.length, 3);
assert.strictEqual(spans[0].label, 'Before SC');
assert.strictEqual(spans[0].addedCount, 1);
assert.strictEqual(spans[1].label, 'SC → FF');
assert.strictEqual(spans[1].addedCount, 1);
assert.strictEqual(spans[1].removedCount, 1);
assert.strictEqual(spans[1].addedDays, 2);
assert.strictEqual(spans[1].removedDays, 3);
assert.strictEqual(spans[2].label, 'After FF');
assert.strictEqual(spans[2].addedCount, 1);
assert.strictEqual(spans[2].addedDays, 4);

const oneMark = ScopeChange.summarizeBetweenMilestones([
  { kind: 'added', time: new Date(2026, 4, 14, 8).getTime(), days: 2 },
], [{ id: 'SC', label: 'SC', time: sc }]);
assert.strictEqual(oneMark.length, 2);
assert.strictEqual(oneMark[0].addedCount, 0);
assert.strictEqual(oneMark[1].label, 'After SC');
assert.strictEqual(oneMark[1].addedCount, 1);

const page = Menu.insightPage('scope-change');
assert.ok(page && page.label === 'Scope change');
assert.ok(Menu.defaultMenuGroups()[0].pages.includes('scope-change'));

const root = path.join(__dirname, '..');
const menuJson = JSON.parse(fs.readFileSync(path.join(root, 'config', 'menu.json'), 'utf8'));
assert.ok(menuJson.groups[0].pages.includes('scope-change'));

const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
assert.ok(html.includes('id="page-scope-change"'));
assert.ok(html.includes('/lib/scope-change.js'));
assert.ok(html.includes("['status', 'fixVersions']"));
assert.ok(html.includes('_includesFixVersions'));
assert.ok(html.includes('Between milestones'));
assert.ok(html.includes('index === 0 && discovery'));
assert.ok(html.includes('phaseReleaseTimelinePlugin'));

const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
assert.ok(proxy.includes('/lib/scope-change.js'));

console.log('scope-change: ok');
