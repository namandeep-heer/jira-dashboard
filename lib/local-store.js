/**
 * File-backed local store for dashboard accounts, sessions, Jira credentials,
 * and shared workspace state. No extra database process or npm native addon.
 *
 * Data lives in data/store.json next to the app (or the standalone executable).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function emptyStore() {
  return {
    version: 1,
    users: [],
    sessions: [],
    credentials: [],
    sharedState: { id: 1, state: {}, updatedAt: null },
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

function createLocalStore(options) {
  const dataDir = options.dataDir;
  const filePath = options.filePath || path.join(dataDir, 'store.json');
  const encryptionKey = options.encryptionKey || '';
  const adminEmail = normalizeEmail(options.adminEmail);
  const sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let db = load();

  function load() {
    if (!fs.existsSync(filePath)) return emptyStore();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      const backup = filePath + '.corrupt-' + Date.now();
      try { fs.copyFileSync(filePath, backup); } catch (_) { /* ignore */ }
      throw new Error('Local store is unreadable. A backup was saved as ' + path.basename(backup));
    }
    return {
      version: 1,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      sharedState: parsed.sharedState && typeof parsed.sharedState === 'object'
        ? parsed.sharedState
        : emptyStore().sharedState,
    };
  }

  function save() {
    atomicWriteJson(filePath, db);
  }

  function credentialCipherKey() {
    if (!encryptionKey) throw httpError(503, 'JIRA_CREDENTIAL_ENCRYPTION_KEY is missing');
    return crypto.createHash('sha256').update(encryptionKey).digest();
  }

  function encryptCredential(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', credentialCipherKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
  }

  function decryptCredential(value) {
    const [iv, authTag, encrypted] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
    if (!iv || !authTag || !encrypted) throw httpError(400, 'Invalid encrypted Jira credential');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialCipherKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
    return 'scrypt$' + salt.toString('base64url') + '$' + hash.toString('base64url');
  }

  function verifyPassword(password, stored) {
    const [scheme, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT_OPTIONS);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }

  function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
  }

  function pruneSessions() {
    const now = Date.now();
    db.sessions = db.sessions.filter(session => session.expiresAt > now);
  }

  function publicUser(user) {
    if (!user) return null;
    return { id: user.id, email: user.email, role: user.role };
  }

  function findUserByEmail(email) {
    const key = normalizeEmail(email);
    return db.users.find(user => user.email === key) || null;
  }

  function findUserById(id) {
    return db.users.find(user => user.id === id) || null;
  }

  function applyAdminRole(user) {
    if (!user) return user;
    if (adminEmail && user.email === adminEmail && user.role !== 'admin') {
      user.role = 'admin';
      save();
    }
    return user;
  }

  function createUser({ email, password }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmail(normalized)) {
      throw httpError(400, 'Enter a valid email address.');
    }
    if (!password || String(password).length < 8) {
      throw httpError(400, 'Password must be at least 8 characters.');
    }
    if (findUserByEmail(normalized)) {
      throw httpError(409, 'An account with this email already exists.');
    }
    const user = {
      id: crypto.randomUUID(),
      email: normalized,
      passwordHash: hashPassword(password),
      role: adminEmail && normalized === adminEmail ? 'admin' : 'viewer',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    save();
    return publicUser(user);
  }

  function createSession(user) {
    const full = findUserById(user.id) || user;
    pruneSessions();
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions.push({
      id: crypto.randomUUID(),
      userId: full.id,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      expiresAt: Date.now() + sessionTtlMs,
    });
    save();
    return { token, expiresAt: Date.now() + sessionTtlMs, user: publicUser(applyAdminRole(full)) };
  }

  function getSession(token) {
    if (!token) return null;
    pruneSessions();
    const tokenHash = hashToken(token);
    const session = db.sessions.find(row => row.tokenHash === tokenHash);
    if (!session) return null;
    const user = applyAdminRole(findUserById(session.userId));
    if (!user) return null;
    return { session, user: publicUser(user) };
  }

  function destroySession(token) {
    if (!token) return;
    const tokenHash = hashToken(token);
    const before = db.sessions.length;
    db.sessions = db.sessions.filter(row => row.tokenHash !== tokenHash);
    if (db.sessions.length !== before) save();
  }

  function login({ email, password }) {
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw httpError(401, 'Invalid email or password.');
    }
    return createSession(applyAdminRole(user));
  }

  function upsertCredentials(userId, { jiraUrl, jiraEmail, token }) {
    const row = {
      userId,
      jiraUrl: String(jiraUrl || '').replace(/\/+$/, ''),
      jiraEmail: normalizeEmail(jiraEmail),
      jiraTokenCiphertext: encryptCredential(token),
      updatedAt: new Date().toISOString(),
    };
    const idx = db.credentials.findIndex(item => item.userId === userId);
    if (idx >= 0) db.credentials[idx] = row;
    else db.credentials.push(row);
    save();
    return row;
  }

  function importEncryptedCredentials({ jiraUrl, jiraEmail, jiraTokenCiphertext, updatedAt }) {
    const email = normalizeEmail(jiraEmail);
    if (!email || !jiraTokenCiphertext) return null;
    decryptCredential(jiraTokenCiphertext);
    const row = {
      userId: null,
      jiraUrl: String(jiraUrl || '').replace(/\/+$/, ''),
      jiraEmail: email,
      jiraTokenCiphertext,
      updatedAt: updatedAt || new Date().toISOString(),
      imported: true,
    };
    const idx = db.credentials.findIndex(item => item.imported && item.jiraEmail === email);
    if (idx >= 0) db.credentials[idx] = row;
    else db.credentials.push(row);
    save();
    return row;
  }

  function claimCredentialsForUser(userId, email) {
    const key = normalizeEmail(email);
    const idx = db.credentials.findIndex(item => item.imported && item.jiraEmail === key);
    if (idx < 0) return null;
    db.credentials[idx].userId = userId;
    delete db.credentials[idx].imported;
    save();
    return db.credentials[idx];
  }

  function getCredentials(userId, { decrypt = false } = {}) {
    const row = db.credentials.find(item => item.userId === userId) || null;
    if (!row) return null;
    const result = {
      jiraUrl: row.jiraUrl,
      jiraEmail: row.jiraEmail,
      updatedAt: row.updatedAt,
    };
    if (decrypt) result.token = decryptCredential(row.jiraTokenCiphertext);
    else result.jiraTokenCiphertext = row.jiraTokenCiphertext;
    return result;
  }

  function getSharedState() {
    return db.sharedState && typeof db.sharedState.state === 'object' ? db.sharedState.state : {};
  }

  function setSharedState(state) {
    db.sharedState = {
      id: 1,
      state: state && typeof state === 'object' ? state : {},
      updatedAt: new Date().toISOString(),
    };
    save();
    return db.sharedState;
  }

  return {
    filePath,
    encryptCredential,
    decryptCredential,
    createUser,
    login,
    createSession,
    getSession,
    destroySession,
    upsertCredentials,
    importEncryptedCredentials,
    claimCredentialsForUser,
    getCredentials,
    getSharedState,
    setSharedState,
    findUserByEmail,
  };
}

module.exports = { createLocalStore };
