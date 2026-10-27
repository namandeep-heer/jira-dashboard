/**
 * Unit tests for Jira writeback planning, cache updates, and the write client.
 * Run: node scripts/test-jira-write.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createJiraWriteApi,
  normalizeChange,
  planCreate,
  replaceIssueInState,
  insertIssueIntoState,
  trimTransitions,
  trimFieldMeta,
  trimIssueTypes,
  trimCreateFields,
  trimUsers,
  jiraErrorMessage,
} = require('../lib/jira-write');

function throws(fn, pattern) {
  assert.throws(fn, err => pattern.test(err.message));
}

const summary = normalizeChange({ type: 'summary', summary: '  Ship the report  ' });
assert.deepStrictEqual(summary.fields, { summary: 'Ship the report' });

const days = normalizeChange({ type: 'number', fieldId: 'customfield_14042', value: '1.256' });
assert.strictEqual(days.fields.customfield_14042, 1.26);
assert.strictEqual(normalizeChange({ type: 'number', fieldId: 'customfield_16133', value: '' }).fields.customfield_16133, null);

const option = normalizeChange({ type: 'option', fieldId: 'customfield_13116', optionId: '10001' });
assert.deepStrictEqual(option.fields.customfield_13116, { id: '10001' });
assert.strictEqual(normalizeChange({ type: 'option', fieldId: 'customfield_17017', optionId: null }).fields.customfield_17017, null);

assert.deepStrictEqual(normalizeChange({ type: 'priority', priorityId: '3' }).fields.priority, { id: '3' });
assert.deepStrictEqual(
  normalizeChange({ type: 'user', fieldId: 'assignee', accountId: 'abc:123' }).fields.assignee,
  { accountId: 'abc:123' }
);
assert.strictEqual(normalizeChange({ type: 'user', fieldId: 'customfield_13004', accountId: '' }).fields.customfield_13004, null);
assert.deepStrictEqual(normalizeChange({ type: 'versions', versions: [] }).fields.fixVersions, []);
assert.deepStrictEqual(normalizeChange({ type: 'versions', versions: [{ id: '9' }] }).fields.fixVersions, [{ id: '9' }]);
assert.strictEqual(normalizeChange({ type: 'parent', parentKey: 'nfs-10' }).fields.parent.key, 'NFS-10');
assert.strictEqual(normalizeChange({ type: 'parent', parentKey: '' }).fields.parent, null);

const transition = normalizeChange({
  type: 'transition',
  transitionId: '31',
  resolutionId: '10000',
  comment: 'Done',
});
assert.strictEqual(transition.kind, 'transition');
assert.strictEqual(transition.body.transition.id, '31');
assert.strictEqual(transition.body.fields.resolution.id, '10000');
assert.strictEqual(transition.body.update.comment[0].add.body.type, 'doc');

throws(() => normalizeChange({ type: 'summary', summary: '' }), /Summary/);
throws(() => normalizeChange({ type: 'number', fieldId: 'summary', value: 1 }), /cannot be edited/);
throws(() => normalizeChange({ type: 'number', fieldId: 'customfield_1', value: -1 }), /0 to 100000/);
throws(() => normalizeChange({ type: 'status' }), /not supported/);
throws(() => normalizeChange({ type: 'parent', parentKey: 'nope' }), /ticket key/);

const trimmed = trimTransitions({
  transitions: [{
    id: 31,
    name: 'Close',
    to: { name: 'Closed' },
    fields: {
      resolution: { required: true, name: 'Resolution', allowedValues: [{ id: '1', name: 'Done' }] },
      comment: { required: false, name: 'Comment' },
      customfield_1: { required: true, name: 'Secret' },
    },
  }],
});
assert.strictEqual(trimmed[0].to.name, 'Closed');
assert.strictEqual(trimmed[0].fields.length, 1);
assert.deepStrictEqual(trimmed[0].unsupported, ['Secret']);

assert.strictEqual(trimFieldMeta({ fields: {} }, 'customfield_1'), null);
assert.strictEqual(trimFieldMeta({ fields: { priority: { name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: 3, name: 'High' }] } } }, 'priority').allowedValues[0].name, 'High');
assert.deepStrictEqual(trimUsers([{ accountId: 'a', displayName: 'Ada', active: true }, { accountId: 'b', active: false }]), [{ accountId: 'a', displayName: 'Ada' }]);
assert.strictEqual(jiraErrorMessage({ errors: { summary: 'too long' }, errorMessages: ['nope'] }, 400), 'nope summary: too long');

const state = {
  cache: { NFS: { issues: [{ key: 'NFS-1', fields: { summary: 'Old', updated: 'T1' }, changelog: { histories: [{ items: [] }] } }] } },
  releaseCache: {
    '2026.R2': { NFS: { issues: [] } },
  },
};
state.releaseCache['2026.R2'].NFS.issues.push(state.cache.NFS.issues[0]);
const updated = {
  key: 'NFS-1',
  id: '9',
  fields: { summary: 'New', updated: 'T2', status: { name: 'Closed' } },
  changelog: { histories: [{ items: [{ field: 'status' }] }] },
};
assert.strictEqual(replaceIssueInState(state, updated), 2);
assert.strictEqual(state.cache.NFS.issues[0].fields.summary, 'New');
assert.strictEqual(state.releaseCache['2026.R2'].NFS.issues[0].fields.status.name, 'Closed');

const created = planCreate({
  projectKey: 'nfs',
  issueTypeId: '10001',
  summary: '  Add the export  ',
  description: 'Line one',
  parentKey: 'nfs-10',
  fixVersionId: '42',
  priorityId: '3',
  fields: { customfield_13116: { id: '10020' } },
  places: [{ release: 'N2027.R1', dashboardKey: 'NFS' }],
});
assert.strictEqual(created.fields.project.key, 'NFS');
assert.strictEqual(created.fields.issuetype.id, '10001');
assert.strictEqual(created.fields.summary, 'Add the export');
assert.strictEqual(created.fields.description.type, 'doc');
assert.strictEqual(created.fields.parent.key, 'NFS-10');
assert.deepStrictEqual(created.fields.fixVersions, [{ id: '42' }]);
assert.deepStrictEqual(created.fields.customfield_13116, { id: '10020' });
assert.strictEqual(created.places[0].dashboardKey, 'NFS');
throws(() => planCreate({ projectKey: 'NFS', issueTypeId: '1', summary: '' }), /Summary/);
throws(() => planCreate({ projectKey: 'x', issueTypeId: '1', summary: 'A' }), /Jira project/);

const createdIssue = { key: 'NFS-9', fields: { summary: 'Add the export' } };
const shared = [{ key: 'NFS-1', fields: { summary: 'Stay' } }];
const createState = { releaseCache: { 'N2027.R1': { NFS: { issues: shared } } } };
assert.strictEqual(insertIssueIntoState(createState, createdIssue, [
  { release: 'N2027.R1', dashboardKey: 'NFS' },
  { release: 'N2027.R1', dashboardKey: 'NFS' },
]), 1);
assert.strictEqual(createState.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-9');
assert.strictEqual(createState.releaseCache['N2027.R1'].NFS.issues[1].key, 'NFS-1');
assert.strictEqual(insertIssueIntoState({ releaseCache: {} }, createdIssue, [{ release: 'N2026.R2', dashboardKey: 'BUGS' }]), 1);

assert.strictEqual(trimIssueTypes([{ id: 1, name: 'Bug', subtask: false }, { id: 2, name: 'Sub-task', subtask: true }]).length, 1);
const createFields = trimCreateFields([
  { fieldId: 'summary', required: true },
  { fieldId: 'description', required: true },
  { fieldId: 'priority', required: true, name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: 3, name: 'High' }] },
  { fieldId: 'customfield_1', required: true, name: 'Secret', schema: { type: 'any' } },
]);
assert.strictEqual(createFields.descriptionRequired, true);
assert.strictEqual(createFields.fields[0].fieldId, 'priority');
assert.deepStrictEqual(createFields.unsupported, ['Secret']);

async function runApply() {
const calls = [];
let saved = null;
const api = createJiraWriteApi({
  async jiraFetch(_creds, method, apiPath, body) {
    calls.push({ method, apiPath, body });
    if (apiPath.includes('fields=updated')) {
      return { ok: true, status: 200, json: { fields: { updated: '2026-01-01T00:00:00.000+0000' } } };
    }
    if (method === 'PUT') return { ok: true, status: 204, json: null, text: '' };
    if (apiPath.includes('/changelog')) {
      return {
        ok: true,
        status: 200,
        json: {
          isLast: true,
          total: 1,
          values: [{ created: '2026-01-02T00:00:00.000+0000', items: [
            { field: 'status', fieldId: 'status', fromString: 'Open', toString: 'Closed' },
            { field: 'summary', fieldId: 'summary', fromString: 'Old', toString: 'New' },
          ] }],
        },
      };
    }
    if (method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: {
          id: '9',
          key: 'NFS-1',
          fields: { summary: 'New', updated: '2026-01-02T00:00:00.000+0000', description: 'secret' },
        },
      };
    }
    return { ok: false, status: 500, json: null, text: '' };
  },
  loadState() {
    return {
      releaseCache: {
        '2026.R2': {
          NFS: { issues: [{ key: 'NFS-1', fields: { summary: 'Old', updated: '2026-01-01T00:00:00.000+0000' } }, { key: 'NFS-2', fields: { summary: 'Stay' } }] },
        },
      },
    };
  },
  saveState(next) { saved = next; },
});

const result = await api.applyChange({ jiraEmail: 'a@b.c', token: 't' }, 'nfs-1', {
  updated: '2026-01-01T00:00:00.000+0000',
  change: { type: 'summary', summary: 'New' },
});
assert.strictEqual(result.issue.fields.summary, 'New');
assert.strictEqual(result.issue.fields.description, undefined);
assert.strictEqual(result.issue.changelog.histories.length, 1);
assert.strictEqual(result.issue.changelog.histories[0].items.length, 1);
assert.strictEqual(saved.releaseCache['2026.R2'].NFS.issues[0].fields.summary, 'New');
assert.strictEqual(saved.releaseCache['2026.R2'].NFS.issues[1].fields.summary, 'Stay');
assert.strictEqual(calls[0].method, 'GET');
assert.strictEqual(calls[1].method, 'PUT');
assert.deepStrictEqual(calls[1].body.fields, { summary: 'New' });
assert.strictEqual(calls[2].method, 'GET');
assert.ok(calls[3].apiPath.includes('/changelog'));

const conflictCalls = [];
const conflict = createJiraWriteApi({
  async jiraFetch() {
    conflictCalls.push(1);
    return { ok: true, status: 200, json: { fields: { updated: '2026-02-02T00:00:00.000+0000' } } };
  },
  loadState() { return {}; },
  saveState() { throw new Error('should not save'); },
});
await assert.rejects(
  () => conflict.applyChange({}, 'NFS-1', { updated: '2026-01-01T00:00:00.000+0000', change: { type: 'summary', summary: 'X' } }),
  err => err.status === 409 && /changed in Jira/.test(err.message)
);
assert.strictEqual(conflictCalls.length, 1);

const staleCalls = [];
const stale = createJiraWriteApi({
  async jiraFetch(_creds, method, apiPath) {
    staleCalls.push({ method, apiPath });
    if (String(apiPath).includes('fields=')) {
      return { ok: true, status: 200, json: { fields: { updated: '2026-05-02T00:00:00.000+0000', customfield_17017: { id: '11', value: 'Committed' } } } };
    }
    if (method === 'PUT') return { ok: true, status: 204, json: null, text: '' };
    if (String(apiPath).includes('/changelog')) return { ok: true, status: 200, json: { isLast: true, total: 0, values: [] } };
    if (method === 'GET') {
      return { ok: true, status: 200, json: { id: '19525', key: 'NFS-19525', fields: { summary: 'Scope', updated: '2026-05-02T00:00:00.000+0000', customfield_17017: { id: '11', value: 'Committed' } } } };
    }
    return { ok: false, status: 500, json: null, text: '' };
  },
  loadState() {
    return {
      releaseCache: {
        'N2027.R1': {
          NFS: { issues: [{ key: 'NFS-19525', fields: { updated: '2026-05-01T00:00:00.000+0000', customfield_17017: { id: '11', value: 'Committed', self: 'https://jira.example/11' } } }] },
        },
      },
    };
  },
  saveState() {},
});
const staleWrote = await stale.applyChange({}, 'NFS-19525', {
  updated: '2026-05-01T00:00:00.000+0000',
  change: { type: 'option', fieldId: 'customfield_17017', optionId: '12' },
});
assert.strictEqual(staleWrote.issue.key, 'NFS-19525');
assert.ok(staleCalls.some(call => call.method === 'PUT'));

const moved = createJiraWriteApi({
  async jiraFetch() {
    return { ok: true, status: 200, json: { fields: { updated: '2026-05-02T00:00:00.000+0000', customfield_17017: { id: '9', value: 'Stretch' } } } };
  },
  loadState() {
    return { releaseCache: { R: { NFS: { issues: [{ key: 'NFS-19525', fields: { updated: '2026-05-01T00:00:00.000+0000', customfield_17017: { id: '11', value: 'Committed' } } }] } } } };
  },
  saveState() { throw new Error('should not save'); },
});
await assert.rejects(
  () => moved.applyChange({}, 'NFS-19525', {
    updated: '2026-05-01T00:00:00.000+0000',
    change: { type: 'option', fieldId: 'customfield_17017', optionId: '12' },
  }),
  err => err.status === 409 && err.updated === '2026-05-02T00:00:00.000+0000' && err.live.customfield_17017.id === '9'
);

const briefCalls = [];
const briefApi = createJiraWriteApi({
  async jiraFetch(_creds, _method, apiPath) {
    briefCalls.push(apiPath);
    return {
      ok: true,
      status: 200,
      json: {
        fields: {
          summary: 'Full summary',
          issuetype: { name: 'Story' },
          status: { name: 'Open' },
          updated: '2026-03-03T00:00:00.000+0000',
        },
      },
    };
  },
  loadState() { return {}; },
  saveState() {},
});
const brief = await briefApi.issueBrief({}, 'FCO-683');
assert.strictEqual(brief.summary, 'Full summary');
assert.strictEqual(brief.updated, '2026-03-03T00:00:00.000+0000');
assert.ok(briefCalls[0].includes('updated'));
assert.strictEqual(brief.field, undefined);

const fieldBrief = await briefApi.issueBrief({}, 'FCO-683', 'customfield_17017');
assert.ok(briefCalls[1].includes('customfield_17017'));
assert.strictEqual(fieldBrief.field, null);

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
assert.ok(dashboard.includes('/lib/jira-write-ui.js'));
assert.ok(dashboard.includes('JiraWrite.wrap'));
assert.ok(dashboard.includes("gapEdit(ticket.key, 'cf_devest'"));
assert.ok(dashboard.includes("gapEdit(ticket.key, 'cf_devact'"));
const writeUi = fs.readFileSync(path.join(root, 'lib', 'jira-write-ui.js'), 'utf8');
assert.ok(dashboard.includes('JiraWrite.daysField') || writeUi.includes('function daysField'));
assert.ok(writeUi.includes('summaryBaseline'));
assert.ok(writeUi.includes('jw-summary'));
assert.ok(writeUi.includes("action === 'retry'"));
assert.ok(writeUi.includes('function recoverConflict'));
assert.ok(writeUi.includes('fieldBaseline'));
assert.ok(writeUi.includes('Save again to replace it'));
assert.ok(writeUi.includes('recoverDays'));
assert.ok(!writeUi.includes('Refresh and try again'));
assert.ok(dashboard.includes('textarea.jw-summary'));
assert.ok(proxy.includes("app.post('/api/jira/issue/:key'"));
assert.ok(proxy.includes("app.post('/api/jira/issues'"));
assert.ok(proxy.includes("app.get('/api/jira/create-meta'"));
assert.ok(proxy.includes('/lib/jira-write-ui.js'));
assert.ok(dashboard.includes('JiraWrite.openCreate'));
assert.ok(dashboard.includes('proj-new-ticket'));
assert.ok(writeUi.includes('openCreate'));
assert.ok(writeUi.includes('function showCreatedPopup'));
assert.ok(writeUi.includes('function revealCreatedIssue'));
assert.ok(writeUi.includes('jw-created-key'));
assert.ok(writeUi.includes('jw-created-name'));
assert.ok(dashboard.includes('data-issue-key'));
assert.ok(dashboard.includes('jw-created-link'));
assert.ok(!writeUi.includes('It is not part of this list'));
assert.ok(writeUi.includes('/api/jira/issues'));
assert.ok(writeUi.includes('/api/jira/create-meta'));

const createCalls = [];
let createdSaved = null;
const createApi = createJiraWriteApi({
  async jiraFetch(_creds, method, apiPath, body) {
    createCalls.push({ method, apiPath, body });
    if (method === 'POST' && apiPath === '/rest/api/3/issue') return { ok: true, status: 201, json: { key: 'NFS-9' } };
    if (apiPath.includes('/changelog')) return { ok: true, status: 200, json: { isLast: true, total: 0, values: [] } };
    if (apiPath.includes('/issuetypes/10001')) {
      return { ok: true, status: 200, json: { isLast: true, total: 1, fields: [{ fieldId: 'summary', required: true }] } };
    }
    if (apiPath.includes('/issuetypes')) {
      return { ok: true, status: 200, json: { isLast: true, total: 1, issueTypes: [{ id: '10001', name: 'Enhancement', subtask: false, hierarchyLevel: 0 }] } };
    }
    if (apiPath.includes('/versions')) return { ok: true, status: 200, json: [{ id: '42', name: 'N2027.R1' }] };
    if (method === 'GET') {
      return { ok: true, status: 200, json: { id: '90', key: 'NFS-9', fields: { summary: 'Add the export', updated: '2026-04-01T00:00:00.000+0000' } } };
    }
    return { ok: false, status: 500, json: null, text: '' };
  },
  loadState() { return { releaseCache: { 'N2027.R1': { NFS: { issues: [{ key: 'NFS-1', fields: { summary: 'Stay' } }] } } } }; },
  saveState(next) { createdSaved = next; },
});
const meta = await createApi.createMeta({}, 'NFS');
assert.strictEqual(meta.issueTypes[0].name, 'Enhancement');
assert.strictEqual(meta.versions[0].name, 'N2027.R1');
const fieldMeta = await createApi.createMeta({}, 'NFS', '10001');
assert.strictEqual(fieldMeta.fields.length, 0);
const made = await createApi.createIssue({}, {
  projectKey: 'NFS',
  issueTypeId: '10001',
  summary: 'Add the export',
  places: [{ release: 'N2027.R1', dashboardKey: 'NFS' }],
});
assert.strictEqual(made.issue.key, 'NFS-9');
assert.strictEqual(made.updatedCache, 1);
assert.strictEqual(createdSaved.releaseCache['N2027.R1'].NFS.issues[0].key, 'NFS-9');
assert.strictEqual(createdSaved.releaseCache['N2027.R1'].NFS.issues[1].key, 'NFS-1');
assert.strictEqual(createCalls.find(call => call.method === 'POST').body.fields.summary, 'Add the export');
}

runApply().then(() => {
  console.log('jira-write tests passed');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
