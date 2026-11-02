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
const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 720;
const MAX_COLUMN_WIDTHS = 40;
const MAX_COLUMN_VIEWS = 12;
const MAX_VIEW_NAME = 40;
const MAX_VIEW_COLUMNS = 40;
const VIEW_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
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

function publicGroupByEpic(row) {
  return !row || row.groupByEpic !== false;
}

function normalizeColumnWidths(widths) {
  if (widths == null) return {};
  if (typeof widths !== 'object' || Array.isArray(widths)) throw httpError(400, 'Column widths must be an object.');
  const next = {};
  Object.keys(widths).slice(0, MAX_COLUMN_WIDTHS).forEach(key => {
    const col = String(key || '').trim();
    if (!COLUMN_RE.test(col)) return;
    const n = Number(widths[key]);
    if (!Number.isFinite(n)) throw httpError(400, 'Column width must be a number.');
    const rounded = Math.round(n);
    if (rounded < MIN_COLUMN_WIDTH || rounded > MAX_COLUMN_WIDTH) {
      throw httpError(400, 'Column width must be between ' + MIN_COLUMN_WIDTH + ' and ' + MAX_COLUMN_WIDTH + '.');
    }
    next[col] = rounded;
  });
  return next;
}

function publicColumnWidths(row) {
  const source = row && row.columnWidths && typeof row.columnWidths === 'object' ? row.columnWidths : {};
  const columnWidths = {};
  Object.keys(source).sort().forEach(key => {
    try {
      const widths = normalizeColumnWidths(source[key]);
      const projectKey = normalizeProjectKey(key);
      if (Object.keys(widths).length) columnWidths[projectKey] = widths;
    } catch (err) {
      /* drop unreadable saved widths instead of failing the whole file */
    }
  });
  return columnWidths;
}

function normalizeFreezeRange(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const column = value.trim();
    if (!column || column === 'notes') return '';
    if (column === 'none') return 'none';
    if (!COLUMN_RE.test(column)) throw httpError(400, 'Choose a column to freeze.');
    return column;
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Choose a column to freeze.');
  const start = value.start == null ? '' : String(value.start).trim();
  const end = value.end == null ? '' : String(value.end).trim();
  if (start === 'none' || end === 'none') return 'none';
  if (!start && !end) return '';
  if (!COLUMN_RE.test(start) || !COLUMN_RE.test(end)) throw httpError(400, 'Choose a column to freeze.');
  if (start === 'notes' && end === 'notes') return '';
  return { start, end };
}

function normalizeViewColumns(columns) {
  if (!Array.isArray(columns)) throw httpError(400, 'Choose the columns for this view.');
  const seen = new Set();
  const next = [];
  columns.forEach(value => {
    const id = String(value == null ? '' : value).trim();
    if (!id || id === 'notes' || seen.has(id)) return;
    if (!COLUMN_RE.test(id)) throw httpError(400, 'Choose a column to show.');
    seen.add(id);
    next.push(id);
  });
  if (next.length > MAX_VIEW_COLUMNS) throw httpError(400, 'A view can include ' + MAX_VIEW_COLUMNS + ' columns.');
  return next;
}

function normalizeColumnViews(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Column views must be an object.');
  const order = normalizeViewColumns(Array.isArray(value.order) ? value.order : []);
  const source = Array.isArray(value.views) ? value.views : [];
  if (source.length > MAX_COLUMN_VIEWS) throw httpError(400, 'Save up to ' + MAX_COLUMN_VIEWS + ' views.');
  const views = [];
  const ids = new Set();
  const names = new Set();
  source.forEach(view => {
    if (!view || typeof view !== 'object' || Array.isArray(view)) throw httpError(400, 'Each view needs a name.');
    const id = String(view.id == null ? '' : view.id).trim().toLowerCase();
    if (!VIEW_ID_RE.test(id) || id === 'default') throw httpError(400, 'Choose a view.');
    if (ids.has(id)) return;
    const name = String(view.name == null ? '' : view.name).replace(/\s+/g, ' ').trim();
    if (!name || name.length > MAX_VIEW_NAME) throw httpError(400, 'Name the view in ' + MAX_VIEW_NAME + ' characters or less.');
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) throw httpError(400, 'A view already uses that name.');
    const columns = normalizeViewColumns(view.columns);
    if (!columns.length) throw httpError(400, 'A view needs at least one column.');
    ids.add(id);
    names.add(nameKey);
    views.push({ id, name, columns });
  });
  let active = String(value.active == null ? 'default' : value.active).trim().toLowerCase();
  if (!active) active = 'default';
  if (active !== 'default' && !views.some(view => view.id === active)) active = 'default';
  if (!order.length && !views.length) return null;
  return { active, order, views };
}

function publicColumnViewEntry(entry) {
  return {
    active: entry.active,
    order: entry.order.slice(),
    views: entry.views.map(view => ({ id: view.id, name: view.name, columns: view.columns.slice() })),
  };
}

function publicColumnViews(row) {
  const source = row && row.columnViews && typeof row.columnViews === 'object' ? row.columnViews : {};
  const columnViews = {};
  Object.keys(source).sort().forEach(key => {
    try {
      const views = normalizeColumnViews(source[key]);
      const projectKey = normalizeProjectKey(key);
      if (views) columnViews[projectKey] = publicColumnViewEntry(views);
    } catch (err) {
      /* drop unreadable saved views instead of failing the whole file */
    }
  });
  return columnViews;
}

function publicColumnFreeze(row) {
  const source = row && row.columnFreeze && typeof row.columnFreeze === 'object' ? row.columnFreeze : {};
  const columnFreeze = {};
  Object.keys(source).sort().forEach(key => {
    try {
      const column = normalizeFreezeRange(source[key]);
      const projectKey = normalizeProjectKey(key);
      if (!column) return;
      columnFreeze[projectKey] = typeof column === 'string' ? column : { start: column.start, end: column.end };
    } catch (err) {
      /* drop unreadable saved freeze choices instead of failing the whole file */
    }
  });
  return columnFreeze;
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
    if (!db.users[userId].columnWidths || typeof db.users[userId].columnWidths !== 'object') {
      db.users[userId].columnWidths = {};
    }
    if (!db.users[userId].columnFreeze || typeof db.users[userId].columnFreeze !== 'object') {
      db.users[userId].columnFreeze = {};
    }
    if (!db.users[userId].columnViews || typeof db.users[userId].columnViews !== 'object') {
      db.users[userId].columnViews = {};
    }
    return db.users[userId];
  }

  function prune(userId) {
    const row = db.users[userId];
    if (!row) return;
    const hasSorts = row.projectSorts && Object.keys(row.projectSorts).length;
    const hasWidths = row.columnWidths && Object.keys(row.columnWidths).length;
    const hasFreeze = row.columnFreeze && Object.keys(row.columnFreeze).length;
    const hasViews = row.columnViews && Object.keys(row.columnViews).length;
    if (!hasSorts && !hasWidths && !hasFreeze && !hasViews && row.groupByEpic !== false) delete db.users[userId];
  }

  return {
    filePath,
    get(userId) {
      const id = normalizeUserId(userId);
      const row = db.users[id];
      return {
        version: 1,
        projectSorts: publicSorts(row),
        groupByEpic: publicGroupByEpic(row),
        columnWidths: publicColumnWidths(row),
        columnFreeze: publicColumnFreeze(row),
        columnViews: publicColumnViews(row),
      };
    },
    setProjectSort(userId, projectKey, levels) {
      const id = normalizeUserId(userId);
      const key = normalizeProjectKey(projectKey);
      const next = normalizeSortLevels(levels);
      const row = ensure(id);
      if (next.length) row.projectSorts[key] = next;
      else delete row.projectSorts[key];
      prune(id);
      save();
      return { version: 1, projectKey: key, levels: next };
    },
    setColumnWidths(userId, projectKey, widths) {
      const id = normalizeUserId(userId);
      const key = normalizeProjectKey(projectKey);
      const next = normalizeColumnWidths(widths);
      const row = ensure(id);
      if (Object.keys(next).length) row.columnWidths[key] = next;
      else delete row.columnWidths[key];
      prune(id);
      save();
      return { version: 1, projectKey: key, widths: next };
    },
    setColumnFreeze(userId, projectKey, column) {
      const id = normalizeUserId(userId);
      const key = normalizeProjectKey(projectKey);
      const next = normalizeFreezeRange(column);
      const row = ensure(id);
      if (next && typeof next === 'object') row.columnFreeze[key] = { start: next.start, end: next.end };
      else if (next) row.columnFreeze[key] = next;
      else delete row.columnFreeze[key];
      prune(id);
      save();
      const freeze = !next ? 'notes' : (typeof next === 'string' ? next : { start: next.start, end: next.end });
      return { version: 1, projectKey: key, freeze };
    },
    setColumnViews(userId, projectKey, spec) {
      const id = normalizeUserId(userId);
      const key = normalizeProjectKey(projectKey);
      const next = normalizeColumnViews(spec);
      const row = ensure(id);
      if (next) row.columnViews[key] = publicColumnViewEntry(next);
      else delete row.columnViews[key];
      prune(id);
      save();
      return { version: 1, projectKey: key, columnViews: next ? publicColumnViewEntry(next) : { active: 'default', order: [], views: [] } };
    },
    setGroupByEpic(userId, enabled) {
      const id = normalizeUserId(userId);
      if (typeof enabled !== 'boolean') throw httpError(400, 'Group by epic must be on or off.');
      const row = ensure(id);
      row.groupByEpic = enabled;
      prune(id);
      save();
      return { version: 1, groupByEpic: enabled };
    },
  };
}

module.exports = {
  MAX_SORT_LEVELS,
  createUserPreferences,
  normalizeSortLevels,
  normalizeColumnWidths,
};
