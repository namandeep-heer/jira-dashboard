/**
 * Unit tests for dashboard cache slimming (persist / store.json payload).
 * Run: node scripts/test-slim-cache.js
 */

'use strict';

const assert = require('assert');
const {
  slimIssue,
  slimChangelog,
  slimDashboardState,
  dashboardStateForClient,
} = require('../lib/slim-cache');

const fatIssue = {
  id: '10001',
  key: 'NFS-1',
  self: 'https://example.atlassian.net/rest/api/3/issue/10001',
  fields: {
    summary: 'Ship SSO',
    status: { name: 'Closed', self: 'https://example/status/1', iconUrl: 'https://example/i.png' },
    assignee: {
      displayName: 'Ada',
      avatarUrls: { '48x48': 'https://example/a.png' },
      self: 'https://example/user/ada',
    },
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'huge adf' }] }] },
    comment: { comments: [{ body: 'noise' }] },
    customfield_10204: 3,
    customfield_10203: 0,
  },
  changelog: {
    histories: [
      {
        id: '9',
        author: { displayName: 'Ada', avatarUrls: { '48x48': 'https://example/a.png' } },
        created: '2026-08-01T12:00:00.000Z',
        items: [
          { field: 'status', fieldId: 'status', fromString: 'Dev-Developing', toString: 'Closed' },
          { field: 'description', fieldId: 'description', fromString: 'old', toString: 'new' },
        ],
      },
      {
        created: '2026-07-01T12:00:00.000Z',
        items: [{ field: 'Comment', toString: 'hello' }],
      },
    ],
  },
};

const slimmedIssue = slimIssue(fatIssue);
assert.strictEqual(slimmedIssue.key, 'NFS-1');
assert.strictEqual(slimmedIssue.id, '10001');
assert.strictEqual(slimmedIssue.fields.summary, 'Ship SSO');
assert.strictEqual(slimmedIssue.fields.customfield_10204, 3);
assert.ok(!slimmedIssue.fields.description);
assert.ok(!slimmedIssue.fields.comment);
assert.ok(!slimmedIssue.fields.assignee.avatarUrls);
assert.ok(!slimmedIssue.fields.assignee.self);
assert.ok(!slimmedIssue.fields.status.self);
assert.strictEqual(slimmedIssue.changelog.histories.length, 1);
assert.deepStrictEqual(slimmedIssue.changelog.histories[0].items, [{
  field: 'status',
  fieldId: 'status',
  fromString: 'Dev-Developing',
  toString: 'Closed',
}]);
assert.ok(!slimmedIssue.changelog.histories[0].author);

const changelog = slimChangelog({
  histories: [{ created: 'x', items: [{ field: 'status', toString: 'QA' }] }],
  _source: 'bulkfetch',
});
assert.strictEqual(changelog._source, 'bulkfetch');
assert.strictEqual(changelog.histories[0].items[0].toString, 'QA');

const state = slimDashboardState({
  page: 'overview',
  activeRelease: '2026.2',
  charts: { keep: 'out' },
  creds: { url: 'https://example.atlassian.net', email: 'ada@example.com', token: 'secret' },
  cache: { NFS: { issues: [fatIssue], total: 1 } },
  releaseCache: {
    '2026.2': { NFS: { issues: [fatIssue], total: 1 } },
    '2026.1': { INC: { issues: [fatIssue], total: 1 } },
  },
  _msState: { x: 1 },
});

assert.strictEqual(state.page, 'overview');
assert.ok(!state.cache);
assert.ok(!state.charts);
assert.ok(!state._msState);
assert.ok(!('_skipNextProjectFetch' in state));
assert.ok(!state.creds.token);
assert.strictEqual(state.creds.email, 'ada@example.com');
assert.strictEqual(state.releaseCache['2026.2'].NFS.issues[0].fields.summary, 'Ship SSO');
assert.ok(!state.releaseCache['2026.2'].NFS.issues[0].fields.description);
assert.strictEqual(state.releaseCache['2026.1'].INC.issues.length, 1);

const again = slimDashboardState(state);
assert.deepStrictEqual(again.releaseCache['2026.2'].NFS.issues[0].fields.summary, 'Ship SSO');
assert.ok(!again.cache);

const forClient = dashboardStateForClient({
  activeRelease: '2026.2',
  releaseCache: state.releaseCache,
});
assert.strictEqual(forClient.cache.NFS.issues[0].key, 'NFS-1');
assert.strictEqual(forClient.releaseCache['2026.2'].NFS.issues[0].key, 'NFS-1');

const fat = JSON.stringify({ cache: { NFS: { issues: [fatIssue] } }, releaseCache: { '2026.2': { NFS: { issues: [fatIssue] } } } });
const thin = JSON.stringify(slimDashboardState({
  activeRelease: '2026.2',
  cache: { NFS: { issues: [fatIssue] } },
  releaseCache: { '2026.2': { NFS: { issues: [fatIssue] } } },
}));
assert.ok(thin.length < fat.length, 'slimmed state should be smaller than duplicated fat cache');

console.log('slim-cache: ok');
