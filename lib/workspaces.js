/**
 * Named ticket lists stored on this machine.
 * Shared by everyone who signs in to the local dashboard.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_WORKSPACES = 40;
const MAX_ITEMS = 500;
const MAX_ADD = 200;
const NAME_MAX = 60;
const SNAP_MAX = 300;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const ID_RE = /^w[a-z0-9]{8}$/;
const SNAP_FIELDS = ['summary', 'status', 'type', 'project', 'priority', 'assignee'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function emptyFile() {
  return { version: 1, workspaces: [] };
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

function cleanName(value) {
  const name = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!name) throw httpError(400, 'Name the workspace.');
  if (name.length > NAME_MAX) throw httpError(400, 'Workspace name is too long (max ' + NAME_MAX + ' characters).');
  return name;
}

function normalizeKey(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!KEY_RE.test(key)) throw httpError(400, 'Enter a ticket key like NFS-123.');
  return key;
}

function normalizeId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!ID_RE.test(id)) throw httpError(400, 'Unknown workspace.');
  return id;
}

function snapText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, SNAP_MAX);
}

function publicItem(item) {
  const out = {
    key: item.key,
    addedAt: item.addedAt || null,
    addedBy: item.addedBy || '',
  };
  SNAP_FIELDS.forEach(field => { out[field] = item[field] || ''; });
  return out;
}

function publicWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt || null,
    createdBy: row.createdBy || '',
    updatedAt: row.updatedAt || null,
    items: (row.items || []).map(publicItem),
  };
}

function createWorkspaces(options) {
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
      throw new Error('Workspaces file is unreadable. A backup was saved as ' + path.basename(backup));
    }
    const workspaces = parsed && Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    return { version: 1, workspaces: workspaces.filter(row => row && typeof row === 'object') };
  }

  function save() {
    atomicWriteJson(filePath, db);
  }

  function list() {
    return {
      version: 1,
      workspaces: db.workspaces.map(publicWorkspace),
    };
  }

  function find(id) {
    const normalized = normalizeId(id);
    const row = db.workspaces.find(item => item.id === normalized);
    if (!row) throw httpError(404, 'That workspace was deleted.');
    return row;
  }

  function assertUniqueName(name, exceptId) {
    const key = name.toLowerCase();
    const clash = db.workspaces.some(row => row.id !== exceptId && String(row.name || '').toLowerCase() === key);
    if (clash) throw httpError(400, 'A workspace with that name already exists.');
  }

  function newId() {
    const used = new Set(db.workspaces.map(row => row.id));
    let id = '';
    do {
      id = 'w' + crypto.randomBytes(4).toString('hex');
    } while (used.has(id));
    return id;
  }

  function readKeys(keys) {
    if (!Array.isArray(keys) || !keys.length) throw httpError(400, 'Choose at least one ticket.');
    if (keys.length > MAX_ADD) throw httpError(400, 'Add up to ' + MAX_ADD + ' tickets at a time.');
    const seen = new Set();
    const next = [];
    keys.forEach(value => {
      const key = normalizeKey(value);
      if (seen.has(key)) return;
      seen.add(key);
      next.push(key);
    });
    return next;
  }

  function snapshotMap(items) {
    const map = new Map();
    if (!items) return map;
    if (!Array.isArray(items)) throw httpError(400, 'Ticket details must be a list.');
    items.forEach(item => {
      if (!item || typeof item !== 'object') return;
      let key = '';
      try { key = normalizeKey(item.key); } catch (err) { return; }
      const snap = {};
      SNAP_FIELDS.forEach(field => {
        if (item[field] == null) return;
        snap[field] = snapText(item[field]);
      });
      map.set(key, snap);
    });
    return map;
  }

  function applySnapshot(item, snap) {
    if (!snap) return;
    SNAP_FIELDS.forEach(field => {
      if (!Object.prototype.hasOwnProperty.call(snap, field)) return;
      if (!snap[field] && item[field]) return;
      item[field] = snap[field];
    });
  }

  return {
    filePath,
    list,
    create({ name, author }) {
      const label = cleanName(name);
      assertUniqueName(label);
      if (db.workspaces.length >= MAX_WORKSPACES) {
        throw httpError(400, 'You can keep up to ' + MAX_WORKSPACES + ' workspaces.');
      }
      const now = new Date().toISOString();
      const row = {
        id: newId(),
        name: label,
        createdAt: now,
        createdBy: String(author || ''),
        updatedAt: now,
        items: [],
      };
      db.workspaces.push(row);
      save();
      return Object.assign(list(), { createdId: row.id });
    },
    rename(id, { name }) {
      const row = find(id);
      const label = cleanName(name);
      assertUniqueName(label, row.id);
      row.name = label;
      row.updatedAt = new Date().toISOString();
      save();
      return list();
    },
    remove(id) {
      const row = find(id);
      db.workspaces = db.workspaces.filter(item => item.id !== row.id);
      save();
      return list();
    },
    addItems(id, { keys, items, author }) {
      const row = find(id);
      const wanted = readKeys(keys);
      const snaps = snapshotMap(items);
      const have = new Set(row.items.map(item => item.key));
      const incoming = wanted.filter(key => !have.has(key));
      if (row.items.length + incoming.length > MAX_ITEMS) {
        throw httpError(400, 'A workspace can hold ' + MAX_ITEMS + ' tickets. This one has ' + row.items.length + '.');
      }
      const now = new Date().toISOString();
      wanted.forEach(key => {
        let item = row.items.find(entry => entry.key === key);
        if (!item) {
          item = { key, addedAt: now, addedBy: String(author || '') };
          row.items.push(item);
        }
        applySnapshot(item, snaps.get(key));
      });
      row.updatedAt = now;
      save();
      return list();
    },
    removeItems(id, { keys }) {
      const row = find(id);
      const drop = new Set(readKeys(keys));
      row.items = row.items.filter(item => !drop.has(item.key));
      row.updatedAt = new Date().toISOString();
      save();
      return list();
    },
  };
}

module.exports = { createWorkspaces, MAX_ITEMS, MAX_ADD, MAX_WORKSPACES };
