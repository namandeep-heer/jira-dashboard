/**
 * Live Jira ticket search: which dashboard project a ticket belongs on.
 * Run: node scripts/test-jira-search.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dashboardProjectForIssue } = require('../lib/jira-search');

const projects = [
  {
    key: 'NFS',
    jql: 'project in (NFS) AND issuetype in (Enhancement, Epic)',
  },
  {
    key: 'BUGS',
    jql: 'project in (NFS, GL, FCO) AND issuetype = Bug',
  },
  {
    key: 'GL',
    jql: 'project = GL AND issuetype in (Enhancement, Epic)',
  },
];

const nfsEnh = dashboardProjectForIssue({
  key: 'NFS-10',
  fields: { issuetype: { name: 'Enhancement' } },
}, projects);
assert.strictEqual(nfsEnh.key, 'NFS');

const nfsBug = dashboardProjectForIssue({
  key: 'nfs-11',
  fields: { issuetype: { name: 'Bug' } },
}, projects);
assert.strictEqual(nfsBug.key, 'BUGS');

const glEpic = dashboardProjectForIssue({
  key: 'GL-3',
  fields: { issuetype: { name: 'Epic' } },
}, projects);
assert.strictEqual(glEpic.key, 'GL');

assert.strictEqual(dashboardProjectForIssue({
  key: 'ZZ-1',
  fields: { issuetype: { name: 'Task' } },
}, projects), null);

assert.strictEqual(dashboardProjectForIssue({ key: 'not-a-key' }, projects), null);

const dashboard = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(__dirname, '../proxy.js'), 'utf8');
const standalone = fs.readFileSync(path.join(__dirname, 'build-standalone.js'), 'utf8');
assert.ok(dashboard.includes('id="jira-search-input"'));
assert.ok(dashboard.includes('Search any Jira ticket'));
assert.ok(dashboard.includes('function loadJiraSearchIssue'));
assert.ok(dashboard.includes('loadJiraSearchIssue(this.dataset.key)'));
assert.ok(!dashboard.includes('loadJiraSearchIssue(${JSON.stringify'));
assert.ok(dashboard.includes('function mergePinnedSearchIssues'));
assert.ok(dashboard.includes('/rest/api/3/issue/picker'));
assert.ok(dashboard.includes('/lib/jira-search.js'));
assert.ok(proxy.includes("app.get('/lib/jira-search.js'"));
assert.ok(standalone.includes("lib', 'jira-search.js'"));

console.log('jira-search ok');
