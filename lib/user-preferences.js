/**
 * Per-user dashboard preferences, stored outside the shared dashboard state.
 * Project sorts are nested column orders for the project issue table.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_SORT_LEVELS = 8;
const MAX_ORDER_VALUES = 24;
const MAX_ORDER_VALUE_LENGTH = 120;
const PROJECT_KEY_RE = /^[^\u0000-\u001f\\/]{1,80}$/;
const COLUMN_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function emptyFile() {
  return { version: 1, users: {} };
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

function normalizeUserId(userId) {
  const id = String(userId || '').trim();
  if (!id || id.length > 80) throw httpError(400, 'Unknown user.');
  return id;
}

function normalizeProjectKey(projectKey) {
  const key = String(projectKey || '').trim();
  if (!PROJECT_KEY_RE.test(key) || key === '.' || key === '..') {
    throw httpError(400, 'Unknown project.');
  }
  return key;
}

function normalizeDir(value) {
  if (value === 1 || value === '1' || value === 'asc' || value === 'ascending') return 1;
  if (value === -1 || value === '-1' || value === 'desc' || value === 'descending') return -1;
  throw httpError(400, 'Sort direction must be ascending or descending.');
}

function normalizeOrder(order, index) {
  if (order == null) return undefined;
  if (!Array.isArray(order)) throw httpError(400, 'Sort order for level ' + (index + 1) + ' must be a list of values.');
  if (order.length > MAX_ORDER_VALUES) {
    throw httpError(400, 'A value order can have at most ' + MAX_ORDER_VALUES + ' values.');
  }
  const seen = new Set();
  const next = [];
  order.forEach(value => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return;
    if (text.length > MAX_ORDER_VALUE_LENGTH) throw httpError(400, 'A sort value is too long.');
    if (seen.has(text)) return;
    seen.add(text);
    next.push(text);
  });
  return next.length ? next : undefined;
}

function normalizeSortLevels(levels) {
  if (levels == null) return [];
  if (!Array.isArray(levels)) throw httpError(400, 'Sort levels must be a list.');
  if (levels.length > MAX_SORT_LEVELS) {
    throw httpError(400, 'A sort can have at most ' + MAX_SORT_LEVELS + ' levels.');
  }
  const seen = new Set();
  return levels.map((level, index) => {
    if (!level || typeof level !== 'object' || Array.isArray(level)) {
      throw httpError(400, 'Sort level ' + (index + 1) + ' is invalid.');
    }
    const col = String(level.col || level.field || '').trim();
    if (!COLUMN_RE.test(col)) throw httpError(400, 'Choose a column for sort level ' + (index + 1) + '.');
    if (seen.has(col)) throw httpError(400, 'Each column can only be used once.');
    seen.add(col);
    const next = { col, dir: normalizeDir(level.dir) };
    const order = normalizeOrder(level.order, index);
    if (order) next.order = order;
    return next;
  });
}

function publicSorts(row) {
  const source = row && row.projectSorts && typeof row.projectSorts === 'object' ? row.projectSorts : {};
  const projectSorts = {};
  Object.keys(source).sort().forEach(key => {
    try {
      const levels = normalizeSortLevels(source[key]);
      if (levels.length) projectSorts[normalizeProjectKey(key)] = levels;
    } catch (err) {
      /* drop unreadable saved sorts instead of failing the whole file */
    }
  });
  return projectSorts;
}

function createUserPreferences(options) {
  const filePath = options.filePath;
  let db = load();

  function load() {
    if (!fs.existsSync(filePath)) return emptyFile();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      const backup = filePath + '.corrupt-' + Date.now();
      try { fs.copyFileSync(filePath, backup); } catch (_) { /* ignore */ }
      throw new Error('User preferences file is unreadable. A backup was saved as ' + path.basename(backup));
    }
    const users = parsed && parsed.users && typeof parsed.users === 'object' && !Array.isArray(parsed.users)
      ? parsed.users
      : {};
    return { version: 1, users };
  }

  function save() {
    atomicWriteJson(filePath, db);
  }

  function ensure(userId) {
    if (!db.users[userId] || typeof db.users[userId] !== 'object' || Array.isArray(db.users[userId])) {
      db.users[userId] = { projectSorts: {} };
    }
    if (!db.users[userId].projectSorts || typeof db.users[userId].projectSorts !== 'object') {
      db.users[userId].projectSorts = {};
    }
    return db.users[userId];
  }

  return {
    filePath,
    get(userId) {
      const id = normalizeUserId(userId);
      return { version: 1, projectSorts: publicSorts(db.users[id]) };
    },
    setProjectSort(userId, projectKey, levels) {
      const id = normalizeUserId(userId);
      const key = normalizeProjectKey(projectKey);
      const next = normalizeSortLevels(levels);
      const row = ensure(id);
      if (next.length) row.projectSorts[key] = next;
      else delete row.projectSorts[key];
      if (!Object.keys(row.projectSorts).length) delete db.users[id];
      save();
      return { version: 1, projectKey: key, levels: next };
    },
  };
}

module.exports = {
  MAX_SORT_LEVELS,
  createUserPreferences,
  normalizeSortLevels,
};
