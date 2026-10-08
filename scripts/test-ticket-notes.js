/**
 * Unit tests for file-backed ticket notes and comments.
 * Run: node scripts/test-ticket-notes.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTicketNotes } = require('../lib/ticket-notes');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-notes-'));
const filePath = path.join(tmpDir, 'ticket-notes.json');
const notes = createTicketNotes({ filePath });

assert.deepStrictEqual(notes.list(), { version: 1, tickets: {} });
assert.throws(() => notes.get('not a key'), /ticket key/);
assert.throws(() => notes.addComment('NFS-1', { body: '   ', author: 'a@example.com' }), /Write a comment/);

const noted = notes.setNote('nfs-12', { note: '  Waiting on design\n', author: 'a@example.com' });
assert.strictEqual(noted.key, 'NFS-12');
assert.strictEqual(noted.note, 'Waiting on design');
assert.strictEqual(noted.noteUpdatedBy, 'a@example.com');
assert.ok(noted.noteUpdatedAt);

const withComment = notes.addComment('NFS-12', { body: 'Checked the spec.', author: 'a@example.com' });
assert.strictEqual(withComment.comments.length, 1);
assert.strictEqual(withComment.comments[0].body, 'Checked the spec.');
const commentId = withComment.comments[0].id;

const other = notes.addComment('NFS-12', { body: 'Second thought.', author: 'b@example.com' });
assert.strictEqual(other.comments.length, 2);

assert.throws(
  () => notes.deleteComment('NFS-12', commentId, { author: 'b@example.com', isAdmin: false }),
  /only your own/
);

const afterOwn = notes.deleteComment('NFS-12', commentId, { author: 'a@example.com', isAdmin: false });
assert.strictEqual(afterOwn.comments.length, 1);
assert.strictEqual(afterOwn.comments[0].author, 'b@example.com');

const remainingId = afterOwn.comments[0].id;
const afterAdmin = notes.deleteComment('NFS-12', remainingId, { author: 'a@example.com', isAdmin: true });
assert.strictEqual(afterAdmin.comments.length, 0);
assert.strictEqual(afterAdmin.note, 'Waiting on design');

notes.setNote('NFS-12', { note: '   ', author: 'a@example.com' });
assert.deepStrictEqual(notes.list().tickets, {});
assert.strictEqual(fs.existsSync(filePath), true);

const reloaded = createTicketNotes({ filePath });
const again = reloaded.addComment('ABC-9', { body: 'Persisted.', author: 'a@example.com' });
assert.strictEqual(again.comments[0].body, 'Persisted.');
const fromDisk = createTicketNotes({ filePath });
assert.strictEqual(fromDisk.get('ABC-9').comments[0].body, 'Persisted.');

assert.throws(
  () => notes.setNote('NFS-1', { note: 'x'.repeat(8001), author: 'a@example.com' }),
  /too long/
);
assert.throws(() => notes.deleteComment('NFS-1', 'missing', { author: 'a@example.com', isAdmin: true }), /not found/);

const corruptPath = path.join(tmpDir, 'corrupt.json');
fs.writeFileSync(corruptPath, '{', 'utf8');
assert.throws(() => createTicketNotes({ filePath: corruptPath }), /unreadable/);
assert.ok(fs.readdirSync(tmpDir).some(name => name.startsWith('corrupt.json.corrupt-')));

console.log('ticket notes ok');
