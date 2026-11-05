/**
 * Release plan scheduling.
 * Run: node scripts/test-release-plan.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const plan = require('../lib/release-plan');

const today = '2026-10-29';
const horizon = '2026-11-06';

function ticket(partial) {
  return Object.assign({
    key: 'NFS-1',
    summary: 'Work',
    status: 'Dev-Pending',
    phase: 'Developer Pending',
    estimate: 2,
    actual: null,
    developer: 'Armaan Gill',
    product: 'Rae Dawn',
    assignee: 'Uma Shah',
    commitment: 'Committed',
    priority: 'Medium',
    devStarted: '',
    leftDev: '',
  }, partial);
}

assert.strictEqual(plan.statusLane('Dev-CR / Merge'), 'active');
assert.strictEqual(plan.statusLane('Dev-ReOpened'), 'active');
assert.strictEqual(plan.statusLane('Dev-Grooming'), 'queue');
assert.strictEqual(plan.statusLane('Prod-Groomed'), 'queue');
assert.strictEqual(plan.statusLane('EOA-Pending Deployment'), 'finishing');
assert.strictEqual(plan.statusLane('PQA-Pending'), 'finishing');
assert.strictEqual(plan.statusLane('Closed'), 'closed');
assert.strictEqual(plan.statusLane('On Hold'), 'hold');

assert.strictEqual(plan.initials('Armaan Gill'), 'AG');
assert.strictEqual(plan.initials('Unassigned'), '');
assert.strictEqual(plan.commitmentColor('Committed'), '#185FA5');
assert.strictEqual(plan.commitmentColor('Stretch'), '#7EAFD4');
assert.notStrictEqual(plan.commitmentColor('Commit CarryOver'), plan.commitmentColor('Request To Commit'));

assert.strictEqual(plan.countWeekdays(today, horizon), 7);
assert.strictEqual(plan.shiftISO('2026-11-02', 5), '2026-11-09');
assert.strictEqual(plan.shiftISO('2026-10-29', 1), '2026-10-30');
assert.strictEqual(plan.shiftISO('2026-10-30', 1), '2026-11-02');
assert.strictEqual(plan.moveWorkingDays('2026-10-29', 1), '2026-10-30');
assert.strictEqual(plan.moveWorkingDays('2026-10-30', 1), '2026-11-02');

const windowed = plan.devWindow({
  fields: { status: { name: 'Dev-Developing' } },
  changelog: {
    histories: [
      { created: '2026-10-27T15:00:00.000+0000', items: [{ field: 'status', fromString: 'Dev-Pending', toString: 'Dev-Developing' }] },
    ],
  },
});
assert.strictEqual(windowed.devStarted, '2026-10-27');
assert.strictEqual(windowed.leftDev, '');

const built = plan.buildReleasePlan({
  today,
  capacityThrough: horizon,
  zoom: 'day',
  size: 'L',
  colour: 'commitment',
  rows: 'person',
  tickets: [
    ticket({ key: 'NFS-A', status: 'Dev-Developing', phase: 'Developing', estimate: 5, devStarted: '2026-10-27', developer: 'Ada Lowe' }),
    ticket({ key: 'NFS-B', status: 'Dev-Pending', estimate: 2, developer: 'Ada Lowe', priority: 'High' }),
    ticket({ key: 'NFS-C', status: 'Dev-Pending', estimate: 20, developer: 'Ada Lowe', priority: 'Low' }),
    ticket({ key: 'NFS-D', status: 'Closed', estimate: 10, developer: 'Ada Lowe', phase: 'Closed' }),
    ticket({ key: 'NFS-E', status: 'Prod-Groomed', estimate: 4, developer: 'Ben Cho', phase: 'Product' }),
  ],
});

assert.strictEqual(built.capacityDays, 7);
assert.strictEqual(built.horizonEnd, horizon);
const ada = built.people.find(group => group.name === 'Ada Lowe');
const bar = key => ada.tickets.find(item => item.key === key);
assert.strictEqual(bar('NFS-A').bar.start, '2026-10-26');
assert.strictEqual(bar('NFS-A').bar.end, '2026-10-30');
assert.strictEqual(bar('NFS-B').bar.start, '2026-11-02');
assert.strictEqual(bar('NFS-B').bar.end, '2026-11-03');
assert.ok(bar('NFS-C').bar, 'a ticket that starts before the horizon stays on the calendar');
assert.strictEqual(bar('NFS-C').bar.start, '2026-11-04');
assert.strictEqual(bar('NFS-D').bar, null);
assert.strictEqual(bar('NFS-D').forward, false);
assert.ok(ada.load >= 27);
assert.ok(ada.unscheduledDays === 0 || ada.unscheduledDays === 20);
assert.deepStrictEqual(ada.tickets.map(item => item.key).filter(key => key === 'NFS-B' || key === 'NFS-C'), ['NFS-B', 'NFS-C']);

const ordered = plan.buildReleasePlan({
  today,
  capacityThrough: horizon,
  order: { 'Ada Lowe': ['NFS-A', 'NFS-C', 'NFS-B'] },
  tickets: [
    ticket({ key: 'NFS-A', status: 'Dev-Developing', phase: 'Developing', estimate: 5, devStarted: '2026-10-27', developer: 'Ada Lowe' }),
    ticket({ key: 'NFS-B', status: 'Dev-Pending', estimate: 2, developer: 'Ada Lowe', priority: 'High' }),
    ticket({ key: 'NFS-C', status: 'Dev-Pending', estimate: 2, developer: 'Ada Lowe', priority: 'Low' }),
  ],
});
const orderedAda = ordered.people[0];
const orderedBar = key => orderedAda.tickets.find(item => item.key === key);
assert.deepStrictEqual(orderedAda.tickets.map(item => item.key), ['NFS-A', 'NFS-C', 'NFS-B']);
assert.strictEqual(orderedBar('NFS-C').bar.start, '2026-11-02');
assert.strictEqual(orderedBar('NFS-B').bar.start, '2026-11-04');

const reflowed = plan.buildReleasePlan({
  today,
  capacityThrough: horizon,
  order: { 'Ada Lowe': ['NFS-C', 'NFS-A', 'NFS-B'] },
  tickets: [
    ticket({ key: 'NFS-A', status: 'Dev-Developing', phase: 'Developing', estimate: 5, devStarted: '2026-10-27', developer: 'Ada Lowe' }),
    ticket({ key: 'NFS-B', status: 'Dev-Pending', estimate: 2, developer: 'Ada Lowe', priority: 'High' }),
    ticket({ key: 'NFS-C', status: 'Dev-Pending', estimate: 2, developer: 'Ada Lowe', priority: 'Low' }),
  ],
});
const reflowBar = key => reflowed.people[0].tickets.find(item => item.key === key);
assert.deepStrictEqual(reflowed.people[0].tickets.map(item => item.key), ['NFS-C', 'NFS-A', 'NFS-B']);
assert.strictEqual(reflowBar('NFS-C').bar.start, '2026-10-29');
assert.strictEqual(reflowBar('NFS-C').bar.end, '2026-10-30');
assert.strictEqual(reflowBar('NFS-A').bar.start, '2026-11-02');
assert.strictEqual(reflowBar('NFS-A').bar.end, '2026-11-06');
assert.strictEqual(reflowBar('NFS-B').bar, null);
assert.deepStrictEqual(plan.movedKeys(['NFS-A', 'NFS-B', 'NFS-C'], 2, 1), ['NFS-A', 'NFS-C', 'NFS-B']);
assert.strictEqual(plan.movedKeys(['NFS-A', 'NFS-B'], 0, 1), null);
assert.deepStrictEqual(
  plan.reorderVisible(['NFS-A', 'NFS-H', 'NFS-B'], ['NFS-A', 'NFS-B'], ['NFS-B', 'NFS-A']),
  ['NFS-B', 'NFS-H', 'NFS-A']
);

const pinned = plan.buildReleasePlan({
  today,
  capacityThrough: horizon,
  overrides: { 'NFS-E': '2026-11-01' },
  tickets: [ticket({ key: 'NFS-E', status: 'Prod-Groomed', estimate: 4, developer: 'Ben Cho' })],
});
const ben = pinned.people[0].tickets[0];
assert.strictEqual(ben.bar.start, '2026-11-02');
assert.strictEqual(ben.bar.pinned, true);

const hidden = plan.buildReleasePlan({
  today,
  capacityThrough: horizon,
  hideUnused: true,
  tickets: [
    ticket({ key: 'NFS-Q', status: 'Dev-Developing', phase: 'Developing', estimate: 30, developer: 'Ben Cho', devStarted: today }),
    ticket({ key: 'NFS-R', status: 'Dev-Pending', phase: 'Developer Pending', estimate: 4, developer: 'Ben Cho' }),
    ticket({ key: 'NFS-Z', status: 'Closed', phase: 'Closed', estimate: 3, developer: 'Ben Cho' }),
  ],
});
assert.strictEqual(hidden.shown, 1);
assert.strictEqual(hidden.total, 3);
assert.ok(hidden.people[0].unscheduledDays >= 4);

const html = plan.renderReleasePlanBoard(built, {
  columns: { prd: true, dev: true, qa: false, est: true, developer: true, status: true },
  linkBase: 'https://jira.example',
});
assert.match(html, /plan-bar/);
assert.match(html, /plan-row-grip/);
assert.match(html, /data-dev="Ada Lowe"/);
assert.ok(html.indexOf('NFS-B') < html.indexOf('NFS-C'));
assert.match(html, /data-plan-edit="summary"/);
assert.match(html, /data-plan-edit="status"/);
assert.match(html, /data-field="cf_devest"/);
assert.doesNotMatch(html, /class="plan-days"/);
assert.doesNotMatch(html, />Days</);
assert.match(html, /is-frozen/);
assert.match(html, /NFS-A/);
const nameOnly = plan.layoutColumns({ prd: true, est: true, developer: true, status: true }, 'name');
assert.strictEqual(nameOnly.cols[0].id, 'name');
assert.strictEqual(nameOnly.cols[0].frozen, true);
assert.strictEqual(nameOnly.cols[1].frozen, false);
assert.strictEqual(nameOnly.frozenWidth, 300);
assert.ok(!nameOnly.cols.some(col => col.id === 'days'));
const throughHidden = plan.layoutColumns({ est: true }, 'prd');
assert.strictEqual(throughHidden.cols.filter(col => col.frozen).pop().id, 'name');
const daysShown = plan.layoutColumns({ est: false }, 'prd');
assert.strictEqual(daysShown.cols.filter(col => col.frozen).pop().id, 'days');
const daysEdit = plan.renderReleasePlanBoard(built, {
  columns: { prd: true, dev: true, qa: true, est: false, developer: true, status: true },
  freezeThrough: 'none',
  linkBase: 'https://jira.example',
});
assert.match(daysEdit, /data-field="cf_devest"/);
assert.match(daysEdit, /data-plan-edit="cf_product"/);
assert.match(daysEdit, /data-plan-edit="cf_dev"/);
assert.match(daysEdit, /data-plan-edit="assignee"/);
assert.doesNotMatch(daysEdit, /is-frozen/);
const estCount = (daysEdit.match(/data-field="cf_devest"/g) || []).length;
const ticketCount = (daysEdit.match(/class="plan-key"/g) || []).length;
assert.strictEqual(estCount, ticketCount);
assert.match(html, /https:\/\/jira\.example\/browse\/NFS-A/);
assert.match(html, /is-today/);
assert.match(html, /Development/);
assert.doesNotMatch(html, /<script/i);

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
const writeUi = fs.readFileSync(path.join(root, 'lib', 'jira-write-ui.js'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'lib', 'menu.js'), 'utf8');
assert.match(dashboard, /\/lib\/release-plan\.js/);
assert.match(dashboard, /id="nav-\$\{esc\(page\.id\)\}"/);
assert.match(menu, /id: 'release-plan'/);
assert.match(dashboard, /id="page-release-plan"/);
assert.match(dashboard, /'release-plan'/);
assert.match(proxy, /\/lib\/release-plan\.js/);
assert.match(dashboard, /plan-freeze-btn/);
assert.match(dashboard, /plan-row-grip/);
assert.match(dashboard, /jira-dashboard.release-plan-order/);
assert.match(dashboard, /planResetOrder/);
assert.match(dashboard, /ReleasePlan\.movedKeys/);
assert.match(dashboard, /planClearPinsFor/);
assert.match(dashboard, /planSetFreeze/);
assert.match(writeUi, /S\.page === 'release-plan'/);

console.log('release-plan: ok');
