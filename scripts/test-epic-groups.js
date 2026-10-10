/**
 * Unit tests for nesting enhancements under epics.
 * Run: node scripts/test-epic-groups.js
 */

'use strict';

const assert = require('assert');
const { groupIssuesUnderEpics } = require('../lib/epic-groups');

function issue(key, type, parent) {
  const fields = { summary: key + ' summary', issuetype: { name: type } };
  if (parent) fields.parent = parent;
  return { key, fields };
}

function epicParent(key, summary) {
  return {
    key,
    fields: {
      summary: summary || key,
      issuetype: { name: 'Epic' },
      status: { name: 'Closed' },
      priority: { name: 'Medium' },
    },
  };
}

const epic = issue('NFS-1', 'Epic');
const childA = issue('NFS-2', 'Enhancement', epicParent('NFS-1', 'Identity'));
const childB = issue('NFS-3', 'Enhancement', epicParent('NFS-1', 'Identity'));
const loose = issue('NFS-9', 'Enhancement');

let rows = groupIssuesUnderEpics([childA, epic, loose, childB]);
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].kind, 'epic');
assert.strictEqual(rows[0].synthetic, false);
assert.strictEqual(rows[0].issue.key, 'NFS-1');
assert.deepStrictEqual(rows[0].children.map(item => item.key), ['NFS-2', 'NFS-3']);
assert.strictEqual(rows[1].issue.key, 'NFS-9');

rows = groupIssuesUnderEpics([epic, childB, childA]);
assert.strictEqual(rows[0].issue.key, 'NFS-1');
assert.deepStrictEqual(rows[0].children.map(item => item.key), ['NFS-3', 'NFS-2']);

const onlyChildren = groupIssuesUnderEpics([
  issue('P2P-2', 'Enhancement', epicParent('P2P-10', 'Common')),
  issue('P2P-8', 'Enhancement'),
  issue('P2P-3', 'Enhancement', epicParent('P2P-10', 'Common')),
]);
assert.strictEqual(onlyChildren.length, 2);
assert.strictEqual(onlyChildren[0].synthetic, true);
assert.strictEqual(onlyChildren[0].issue.key, 'P2P-10');
assert.strictEqual(onlyChildren[0].issue.fields.summary, 'Common');
assert.strictEqual(onlyChildren[0].issue.fields.status.name, 'Closed');
assert.deepStrictEqual(onlyChildren[0].children.map(item => item.key), ['P2P-2', 'P2P-3']);
assert.strictEqual(onlyChildren[1].issue.key, 'P2P-8');

const notEpicParent = issue('NFS-4', 'Enhancement', {
  key: 'NFS-50',
  fields: { summary: 'Story parent', issuetype: { name: 'Story' } },
});
rows = groupIssuesUnderEpics([epic, notEpicParent]);
assert.deepStrictEqual(rows.map(row => row.kind), ['issue', 'issue']);

const bareEpic = groupIssuesUnderEpics([epic, loose]);
assert.deepStrictEqual(bareEpic.map(row => row.kind), ['issue', 'issue']);

assert.deepStrictEqual(groupIssuesUnderEpics(null), []);

console.log('epic groups ok');
