/**
 * Unit tests for the local JSON store (auth, sessions, credentials, shared state).
 * Run: node scripts/test-local-store.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalStore } = require('../lib/local-store');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-store-'));
const encryptionKey = 'test-encryption-key-' + Date.now();

function store(extra = {}) {
  return createLocalStore({
    dataDir: tmpDir,
    filePath: path.join(tmpDir, extra.fileName || 'store.json'),
    encryptionKey,
    adminEmail: extra.adminEmail || 'admin@example.com',
    sessionTtlMs: extra.sessionTtlMs,
  });
}

const db = store();

const admin = db.createUser({ email: 'Admin@example.com', password: 'secret123' });
assert.strictEqual(admin.email, 'admin@example.com');
assert.strictEqual(admin.role, 'admin');
assert.ok(admin.id);

const viewer = db.createUser({ email: 'viewer@example.com', password: 'viewerpass' });
assert.strictEqual(viewer.role, 'viewer');

assert.throws(
  () => db.createUser({ email: 'admin@example.com', password: 'another12' }),
  /already exists/
);
assert.throws(
  () => db.createUser({ email: 'bad', password: 'secret123' }),
  /valid email/
);
assert.throws(
  () => db.createUser({ email: 'short@example.com', password: '123' }),
  /at least 8/
);

const login = db.login({ email: 'admin@example.com', password: 'secret123' });
assert.ok(login.token);
assert.strictEqual(login.user.role, 'admin');

assert.throws(
  () => db.login({ email: 'admin@example.com', password: 'wrong-password' }),
  /Invalid email or password/
);

const session = db.getSession(login.token);
assert.strictEqual(session.user.email, 'admin@example.com');
assert.strictEqual(session.user.role, 'admin');
assert.strictEqual(db.getSession('missing'), null);

db.destroySession(login.token);
assert.strictEqual(db.getSession(login.token), null);

const expired = store({ fileName: 'expired.json', sessionTtlMs: 1 });
expired.createUser({ email: 'admin@example.com', password: 'secret123' });
const shortLived = expired.login({ email: 'admin@example.com', password: 'secret123' });
const wait = Date.now() + 20;
while (Date.now() < wait) { /* expire the 1ms session */ }
assert.strictEqual(expired.getSession(shortLived.token), null);

db.upsertCredentials(admin.id, {
  jiraUrl: 'https://example.atlassian.net/',
  jiraEmail: 'Admin@example.com',
  token: 'jira-api-token',
});
const creds = db.getCredentials(admin.id, { decrypt: true });
assert.strictEqual(creds.jiraUrl, 'https://example.atlassian.net');
assert.strictEqual(creds.jiraEmail, 'admin@example.com');
assert.strictEqual(creds.token, 'jira-api-token');
assert.ok(!('jiraTokenCiphertext' in creds));

const encrypted = db.getCredentials(admin.id);
assert.ok(encrypted.jiraTokenCiphertext);
assert.ok(!encrypted.token);
assert.strictEqual(db.decryptCredential(encrypted.jiraTokenCiphertext), 'jira-api-token');

const imported = db.importEncryptedCredentials({
  jiraUrl: 'https://example.atlassian.net/',
  jiraEmail: 'viewer@example.com',
  jiraTokenCiphertext: db.encryptCredential('imported-token'),
});
assert.strictEqual(imported.imported, true);
assert.strictEqual(db.claimCredentialsForUser(viewer.id, 'viewer@example.com').userId, viewer.id);
assert.strictEqual(db.getCredentials(viewer.id, { decrypt: true }).token, 'imported-token');

db.setSharedState({ page: 'setup', enabled: ['key'] });
assert.deepStrictEqual(db.getSharedState(), { page: 'setup', enabled: ['key'] });

const reopened = store();
assert.strictEqual(reopened.findUserByEmail('admin@example.com').role, 'admin');
assert.deepStrictEqual(reopened.getSharedState(), { page: 'setup', enabled: ['key'] });
assert.strictEqual(reopened.getCredentials(admin.id, { decrypt: true }).token, 'jira-api-token');

const promoted = store({ fileName: 'promote.json', adminEmail: 'later-admin@example.com' });
const later = promoted.createUser({ email: 'later-admin@example.com', password: 'secret123' });
assert.strictEqual(later.role, 'admin');
const other = store({ fileName: 'promote.json', adminEmail: 'new-admin@example.com' });
other.createUser({ email: 'new-admin@example.com', password: 'secret123' });
const newAdminLogin = other.login({ email: 'new-admin@example.com', password: 'secret123' });
assert.strictEqual(newAdminLogin.user.role, 'admin');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('local-store: ok');
