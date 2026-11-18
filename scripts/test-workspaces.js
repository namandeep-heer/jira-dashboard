/**
 * Unit tests for workspaces and workspace search queries.
 * Run: node scripts/test-workspaces.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorkspaces, MAX_ITEMS } = require('../lib/workspaces');
const { workspaceSearchJql } = require('../lib/workspace-query');

assert.strictEqual(workspaceSearchJql('nfs-12'), 'key = NFS-12');
assert.strictEqual(workspaceSearchJql('NFS-1, gl-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('project = NFS AND status = Open'), 'project = NFS AND status = Open');
assert.strictEqual(workspaceSearchJql('project in (NFS, GL)'), 'project in (NFS, GL)');
assert.strictEqual(workspaceSearchJql('closing watch'), 'text ~ "closing watch" ORDER BY updated DESC');
assert.strictEqual(workspaceSearchJql('say "hello"'), 'text ~ "say \\"hello\\"" ORDER BY updated DESC');
assert.throws(() => workspaceSearchJql('   '), /ticket key or a query/);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-ws-'));
const filePath = path.join(tmpDir, 'workspaces.json');
const store = createWorkspaces({ filePath });

assert.deepStrictEqual(store.list(), { version: 1, workspaces: [] });
assert.throws(() => store.create({ name: '   ', author: 'a@example.com' }), /Name the workspace/);

const created = store.create({ name: '  Closing watch  ', author: 'a@example.com' });
assert.strictEqual(created.workspaces.length, 1);
assert.strictEqual(created.workspaces[0].name, 'Closing watch');
assert.strictEqual(created.workspaces[0].createdBy, 'a@example.com');
assert.strictEqual(created.workspaces[0].items.length, 0);
const id = created.createdId;
assert.ok(/^w[a-z0-9]{8}$/.test(id));

assert.throws(() => store.create({ name: 'closing watch', author: 'b@example.com' }), /already exists/);
assert.throws(() => store.rename(id, { name: '' }), /Name the workspace/);
assert.throws(() => store.rename('nope', { name: 'Other' }), /Unknown workspace/);

const renamed = store.rename(id, { name: 'Release watch' });
assert.strictEqual(renamed.workspaces[0].name, 'Release watch');

const added = store.addItems(id, {
  keys: ['nfs-1', 'NFS-1', 'GL-9'],
  items: [{ key: 'nfs-1', summary: '  First ticket ', status: 'Open', type: 'Bug', project: 'NFS', priority: 'High', assignee: 'Ada' }],
  author: 'a@example.com',
});
assert.strictEqual(added.workspaces[0].items.length, 2);
assert.strictEqual(added.workspaces[0].items[0].key, 'NFS-1');
assert.strictEqual(added.workspaces[0].items[0].summary, 'First ticket');
assert.strictEqual(added.workspaces[0].items[0].addedBy, 'a@example.com');
const addedAt = added.workspaces[0].items[0].addedAt;

const refreshed = store.addItems(id, {
  keys: ['NFS-1'],
  items: [{ key: 'NFS-1', summary: 'Renamed in Jira', status: 'In Progress' }],
  author: 'b@example.com',
});
assert.strictEqual(refreshed.workspaces[0].items.length, 2);
assert.strictEqual(refreshed.workspaces[0].items[0].summary, 'Renamed in Jira');
assert.strictEqual(refreshed.workspaces[0].items[0].status, 'In Progress');
assert.strictEqual(refreshed.workspaces[0].items[0].assignee, 'Ada');
assert.strictEqual(refreshed.workspaces[0].items[0].addedAt, addedAt);
assert.strictEqual(refreshed.workspaces[0].items[0].addedBy, 'a@example.com');

const kept = store.addItems(id, {
  keys: ['NFS-1'],
  items: [{ key: 'NFS-1', summary: '' }],
  author: 'b@example.com',
});
assert.strictEqual(kept.workspaces[0].items[0].summary, 'Renamed in Jira');

assert.throws(() => store.addItems(id, { keys: ['not a key'] }), /ticket key/);
assert.throws(() => store.addItems(id, { keys: [] }), /at least one ticket/);

const removed = store.removeItems(id, { keys: ['gl-9', 'MISSING-1'] });
assert.deepStrictEqual(removed.workspaces[0].items.map(item => item.key), ['NFS-1']);

const other = store.create({ name: 'Blockers', author: 'a@example.com' });
assert.strictEqual(other.workspaces.length, 2);
const gone = store.remove(other.createdId);
assert.strictEqual(gone.workspaces.length, 1);
assert.throws(() => store.remove(other.createdId), /deleted/);

const keys = [];
for (let i = 0; i < MAX_ITEMS; i++) keys.push('NFS-' + (i + 1));
assert.throws(() => store.addItems(id, { keys: keys.slice(0, 201), author: 'a@example.com' }), /200/);
store.addItems(id, { keys: keys.slice(1, 201), author: 'a@example.com' });
const rest = keys.slice(201);
while (rest.length) {
  store.addItems(id, { keys: rest.splice(0, 200), author: 'a@example.com' });
}
assert.strictEqual(store.list().workspaces[0].items.length, MAX_ITEMS);
assert.throws(() => store.addItems(id, { keys: ['GL-1'], author: 'a@example.com' }), /500/);

const reloaded = createWorkspaces({ filePath });
assert.strictEqual(reloaded.list().workspaces[0].name, 'Release watch');
assert.strictEqual(reloaded.list().workspaces[0].items.length, MAX_ITEMS);

const badPath = path.join(tmpDir, 'bad.json');
fs.writeFileSync(badPath, '{', 'utf8');
assert.throws(() => createWorkspaces({ filePath: badPath }), /unreadable/);
assert.ok(fs.readdirSync(tmpDir).some(name => name.startsWith('bad.json.corrupt-')));

console.log('workspaces ok');
