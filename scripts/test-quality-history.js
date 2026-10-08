/**
 * Unit tests for Quality history charts.
 * Run: node scripts/test-quality-history.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { classifyQualityStatus, priorityBand, buildQualityHistory } = require('../lib/quality-history');

function lane(status) {
  return classifyQualityStatus(status).lane;
}

assert.strictEqual(lane('Creating'), 'grooming');
assert.strictEqual(lane('PQA/EOA-Creating'), 'grooming');
assert.strictEqual(lane('Prod-Pending'), 'grooming');
assert.strictEqual(classifyQualityStatus('Prod-Pending').role, 'pending');
assert.strictEqual(lane('Dev-Grooming'), 'grooming');
assert.strictEqual(classifyQualityStatus('Dev-Grooming').role, 'active');
assert.strictEqual(lane('Dev-Designing'), 'grooming');
assert.strictEqual(lane('Dev-Groomed'), 'developing');
assert.strictEqual(classifyQualityStatus('Dev-Pending').role, 'pending');
assert.strictEqual(classifyQualityStatus('Dev-Developing').role, 'active');
assert.strictEqual(lane('Dev-CR / Merge'), 'developing');
assert.strictEqual(lane('Dev-ReOpened'), 'developing');
assert.strictEqual(lane('Dev-Pending Deployment'), 'testing');
assert.strictEqual(classifyQualityStatus('PQA-Pending').role, 'pending');
assert.strictEqual(classifyQualityStatus('PQA-Testing').role, 'active');
assert.strictEqual(lane('Rejected'), 'testing');
assert.strictEqual(classifyQualityStatus('Closed').closed, true);
assert.strictEqual(classifyQualityStatus('Fixed').closed, true);
assert.strictEqual(classifyQualityStatus('Done / EOA-Automating').closed, true);
assert.strictEqual(classifyQualityStatus('On Hold').hold, true);
assert.strictEqual(lane('COE/SEN-Pending'), null);

assert.strictEqual(priorityBand('Blocker'), 'Critical');
assert.strictEqual(priorityBand('Highest'), 'Critical');
assert.strictEqual(priorityBand('Major'), 'High');
assert.strictEqual(priorityBand('Medium'), 'Medium');
assert.strictEqual(priorityBand('Trivial'), 'Low');
assert.strictEqual(priorityBand(''), 'None');

function issue(created, status, changes, extra) {
  return {
    key: 'NFS-1',
    fields: {
      created,
      status: { name: status },
      issuetype: { name: (extra && extra.type) || 'Bug' },
      priority: { name: (extra && extra.priority) || 'Medium' },
    },
    changelog: {
      histories: (changes || []).map(change => ({
        created: change.at,
        items: [{ field: 'status', fromString: change.from, toString: change.to }],
      })),
    },
  };
}

const walked = issue('2026-01-05T12:00:00', 'Closed', [
  { at: '2026-01-12T12:00:00', from: 'Creating', to: 'Dev-Grooming' },
  { at: '2026-01-19T12:00:00', from: 'Dev-Grooming', to: 'Dev-Pending' },
  { at: '2026-01-26T12:00:00', from: 'Dev-Pending', to: 'Dev-Developing' },
  { at: '2026-02-02T12:00:00', from: 'Dev-Developing', to: 'PQA-Pending' },
  { at: '2026-02-09T12:00:00', from: 'PQA-Pending', to: 'PQA-Testing' },
  { at: '2026-02-16T12:00:00', from: 'PQA-Testing', to: 'Closed' },
]);
const stayed = issue('2026-01-05T12:00:00', 'Dev-Developing', [], {
  type: 'R&D Pre-GoLive Bug',
  priority: 'High',
});

const history = buildQualityHistory([walked, stayed], {
  now: new Date(2026, 2, 1, 12, 0, 0, 0),
  period: 'week',
  milestones: [
    { id: 'DA', label: 'DA', date: '2026-01-08', color: '#185FA5' },
    { id: 'GA', label: 'GA', date: '2026-02-20', color: '#2d6a10' },
  ],
});

function weekIndex(label) {
  const idx = history.labels.indexOf(label);
  assert.ok(idx >= 0, 'missing week ' + label + ' in ' + history.labels.join(', '));
  return idx;
}

const jan10 = weekIndex('Jan 10');
const jan17 = weekIndex('Jan 17');
const jan24 = weekIndex('Jan 24');
const jan31 = weekIndex('Jan 31');
const feb7 = weekIndex('Feb 7');
const feb21 = weekIndex('Feb 21');

assert.strictEqual(history.stages.grooming.pendingActive[jan10], 1);
assert.strictEqual(history.stages.grooming.totalWork[jan10], 1);
assert.strictEqual(history.stages.developing.toCome[jan10], 1);
assert.strictEqual(history.stages.developing.pendingActive[jan10], 1);
assert.strictEqual(history.stages.grooming.open[jan10], 2);
assert.strictEqual(history.flow.groomingIn[jan10], 1);
assert.strictEqual(history.flow.developingIn[jan10], 1);

assert.strictEqual(history.stages.grooming.pendingActive[jan17], 1);
assert.strictEqual(history.flow.groomingIn[jan17], 0);

assert.strictEqual(history.stages.grooming.handled[jan24], 1);
assert.strictEqual(history.stages.developing.pendingActive[jan24], 2);
assert.strictEqual(history.flow.groomingOut[jan24], 1);
assert.strictEqual(history.flow.developingIn[jan24], 1);

assert.strictEqual(history.stages.developing.pendingActive[jan31], 2);
assert.strictEqual(history.flow.developingIn[jan31], 0);
assert.strictEqual(history.flow.active[jan31], 2);

assert.strictEqual(history.stages.testing.pendingActive[feb7], 1);
assert.strictEqual(history.stages.developing.handled[feb7], 1);
assert.strictEqual(history.flow.developingOut[feb7], 1);
assert.strictEqual(history.flow.testingIn[feb7], 1);

assert.strictEqual(history.stages.grooming.open[feb21], 1);
assert.strictEqual(history.stages.testing.handled[feb21], 1);
assert.strictEqual(history.flow.testingOut[feb21], 1);
assert.strictEqual(history.stages.grooming.totalWork[feb21], 1);

const bugType = history.types.find(item => item.label === 'Bug');
const preType = history.types.find(item => item.label === 'R&D Pre-GoLive Bug');
assert.strictEqual(bugType.data[jan10], 1);
assert.strictEqual(preType.data[jan10], 1);
assert.strictEqual(bugType.data[feb21], 0);
assert.strictEqual(preType.data[feb21], 1);
assert.ok(history.types.findIndex(item => item.label === 'Bug') < history.types.findIndex(item => item.label === 'R&D Pre-GoLive Bug'));

const high = history.priorities.find(item => item.label === 'High');
const medium = history.priorities.find(item => item.label === 'Medium');
assert.strictEqual(high.data[jan10], 1);
assert.strictEqual(medium.data[jan10], 1);
assert.strictEqual(medium.data[feb21], 0);

const da = history.markers.find(marker => marker.id.indexOf('DA') !== -1);
const ga = history.markers.find(marker => marker.id.indexOf('GA') !== -1);
assert.ok(da && da.idx === jan10);
assert.ok(ga && ga.idx === feb21);
assert.deepStrictEqual(history.groups, {});
assert.strictEqual(history.members, null);

function deliveryCopy(source, project, scope) {
  const copy = JSON.parse(JSON.stringify(source));
  copy._releaseProject = project;
  copy.fields.customfield_10201 = { value: scope };
  return copy;
}

function deliveryGroupAt(issue, status) {
  let phase = 'Other';
  if (/closed|done|fixed/i.test(status)) phase = 'Closed';
  else if (/pqa|qa/i.test(status)) phase = 'QA';
  else if (/develop/i.test(status)) phase = 'Developing';
  else if (/groom|creating/i.test(status)) phase = 'Product';
  return {
    phase,
    project: issue._releaseProject,
    scope: (issue.fields.customfield_10201 && issue.fields.customfield_10201.value) || 'Not Set',
  };
}

const grouped = buildQualityHistory([
  deliveryCopy(walked, 'Lease Accounting 6.x', 'Committed'),
  deliveryCopy(stayed, 'General Ledger', 'Not Set'),
], {
  now: new Date(2026, 2, 1, 12, 0, 0, 0),
  period: 'week',
  groupAt: deliveryGroupAt,
  groupOrder: { phase: ['Product', 'Developing', 'QA', 'Other'] },
});
const gJan10 = grouped.labels.indexOf('Jan 10');
const gFeb21 = grouped.labels.indexOf('Feb 21');
const product = grouped.groups.phase.find(item => item.label === 'Product');
const developingPhase = grouped.groups.phase.find(item => item.label === 'Developing');
const qaPhase = grouped.groups.phase.find(item => item.label === 'QA');
assert.strictEqual(product.data[gJan10], 1);
assert.strictEqual(developingPhase.data[gJan10], 1);
assert.strictEqual(qaPhase.data[gJan10], 0);
assert.strictEqual(product.data[gFeb21], 0);
assert.strictEqual(developingPhase.data[gFeb21], 1);
assert.ok(!grouped.groups.phase.some(item => item.label === 'Closed'));
assert.ok(grouped.groups.phase.findIndex(item => item.label === 'Product') < grouped.groups.phase.findIndex(item => item.label === 'Developing'));
assert.strictEqual(grouped.groups.project.find(item => item.label === 'Lease Accounting 6.x').data[gJan10], 1);
assert.strictEqual(grouped.groups.project.find(item => item.label === 'Lease Accounting 6.x').data[gFeb21], 0);
assert.strictEqual(grouped.groups.project.find(item => item.label === 'General Ledger').data[gFeb21], 1);
assert.strictEqual(grouped.groups.scope.find(item => item.label === 'Committed').data[gFeb21], 0);
assert.strictEqual(grouped.groups.scope.find(item => item.label === 'Not Set').data[gFeb21], 1);

const limited = buildQualityHistory([
  deliveryCopy(walked, 'Lease Accounting 6.x', 'Committed'),
  deliveryCopy(stayed, 'General Ledger', 'Not Set'),
], {
  now: new Date(2026, 2, 1, 12, 0, 0, 0),
  period: 'week',
  groupAt: deliveryGroupAt,
  groupLimit: { scope: 1 },
  includeMembers: true,
});
assert.strictEqual(limited.groups.scope.length, 1);
assert.strictEqual(limited.groups.scope[0].label, 'Other');
assert.strictEqual(limited.groups.scope[0].data[limited.labels.indexOf('Jan 10')], 2);
assert.strictEqual(limited.groups.scope[0].tickets[limited.labels.indexOf('Jan 10')].length, 2);

const walkedListed = JSON.parse(JSON.stringify(walked));
walkedListed.fields.summary = 'Walk to close';
const stayedListed = JSON.parse(JSON.stringify(stayed));
stayedListed.key = 'GL-9';
stayedListed.fields.summary = 'Stay in dev';
const listed = buildQualityHistory([walkedListed, stayedListed], {
  now: new Date(2026, 2, 1, 12, 0, 0, 0),
  period: 'week',
  includeMembers: true,
});
function keysAt(rows, index) {
  return (rows[index] || []).map(row => row.key).sort();
}
const listJan10 = listed.labels.indexOf('Jan 10');
const listJan24 = listed.labels.indexOf('Jan 24');
const listFeb21 = listed.labels.indexOf('Feb 21');
assert.deepStrictEqual(keysAt(listed.members.stages.grooming.pendingActive, listJan10), ['NFS-1']);
assert.strictEqual(listed.members.stages.grooming.pendingActive[listJan10][0].summary, 'Walk to close');
assert.strictEqual(listed.members.stages.grooming.pendingActive[listJan10][0].status, 'Creating');
assert.deepStrictEqual(keysAt(listed.members.stages.grooming.pendingActive, listJan24), []);
assert.deepStrictEqual(keysAt(listed.members.stages.developing.pendingActive, listJan24), ['GL-9', 'NFS-1']);
assert.deepStrictEqual(keysAt(listed.members.flow.groomingOut, listJan24), ['NFS-1']);
assert.ok(listed.members.flow.groomingOut[listJan24][0].move.indexOf('Dev-Grooming → Dev-Pending') !== -1);
assert.deepStrictEqual(keysAt(listed.members.flow.open, listFeb21), ['GL-9']);
assert.strictEqual(listed.members.stages.grooming.pendingActive[listJan10].length, listed.stages.grooming.pendingActive[listJan10]);
const listedBug = listed.types.find(item => item.label === 'Bug');
assert.deepStrictEqual(keysAt(listedBug.tickets, listJan10), ['NFS-1']);

const futureGrouped = buildQualityHistory([
  deliveryCopy(stayed, 'General Ledger', 'Not Set'),
], {
  now: new Date(2026, 0, 10, 12, 0, 0, 0),
  period: 'week',
  milestones: [{ id: 'GA', label: 'GA', date: '2026-03-01', color: '#2d6a10' }],
  groupAt: deliveryGroupAt,
});
assert.strictEqual(futureGrouped.groups.phase[0].data[futureGrouped.labels.length - 1], null);
assert.ok(futureGrouped.groups.phase[0].data.some(value => value === 1));

const longRange = buildQualityHistory([issue('2022-04-27T12:00:00', 'Dev-Developing', [])], {
  now: new Date(2026, 9, 8, 12, 0, 0, 0),
  period: 'week',
});
assert.strictEqual(longRange.truncated, true);
assert.strictEqual(longRange.labels.length, 180);
assert.strictEqual(longRange.labels[longRange.labels.length - 1], 'Oct 10');
assert.strictEqual(longRange.flow.open[longRange.labels.length - 1], 1);

const future = buildQualityHistory([stayed], {
  now: new Date(2026, 0, 10, 12, 0, 0, 0),
  period: 'week',
  milestones: [{ id: 'GA', label: 'GA', date: '2026-03-01', color: '#2d6a10' }],
});
const last = future.labels.length - 1;
assert.strictEqual(future.labels[last], 'Mar 7');
assert.strictEqual(future.stages.developing.open[last], null);
assert.strictEqual(future.flow.open[last], null);
assert.ok(future.stages.developing.open.some(value => value === 1));

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
assert.match(dashboard, /quality-history\.js/);
assert.match(dashboard, /Grooming History/);
assert.match(dashboard, /Developing History/);
assert.match(dashboard, /Testing History/);
assert.match(dashboard, /Bug Work Incoming &amp; Outgoing History|Bug Work Incoming & Outgoing History/);
assert.match(dashboard, /Open Bugs By Issue Type/);
assert.match(dashboard, /Open Bugs By Priority/);
assert.match(dashboard, /buildQualityHistory/);
assert.match(dashboard, /function toggleQualityHistoryMaximize\(canvasId, force\)/);
assert.match(dashboard, /\.qi-history-card\.is-fullscreen/);
assert.match(dashboard, /qi-history-max/);
assert.match(dashboard, /phaseSeriesSwatchHtml\(color, dashed\)/);
assert.match(dashboard, /class="chart-card qi-history-card"/);
assert.match(dashboard, /id="an-history-grid"/);
assert.match(dashboard, /Open Work By Phase/);
assert.match(dashboard, /Open Work By Project/);
assert.match(dashboard, /Open Work By Scope/);
assert.match(dashboard, /Work Incoming &amp; Outgoing History|Work Incoming & Outgoing History/);
assert.match(dashboard, /Earlier scope changes are not in the changelog/);
assert.match(dashboard, /function drawAnalyticsHistoryCharts\(projects\)/);
assert.match(dashboard, /Click a point to list the tickets in that count/);
assert.match(dashboard, /function showHistoryPointList\(canvasId, seriesKey, index, seriesLabel\)/);
assert.match(dashboard, /class="qi-history-list"/);
assert.match(dashboard, /includeMembers: true/);

console.log('quality-history: ok');
