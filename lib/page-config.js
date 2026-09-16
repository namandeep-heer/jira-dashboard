/**
 * Persist Config-section pages as one pretty-printed JSON file each under config/.
 * Synced Jira cache, sessions, and encrypted tokens stay in data/store.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PAGE_CONFIGS = [
  {
    page: 'setup',
    file: 'setup.json',
    extract(state) {
      return {
        jiraEmail: String(state.creds && state.creds.email || '').trim(),
      };
    },
    apply(state, data) {
      const email = String(data && data.jiraEmail || '').trim();
      if (!email) return;
      state.creds = { ...(state.creds || {}), email };
    },
    strip() {
      // Email may also live on encrypted credentials in store.json; do not strip creds.
    },
    isEmpty(data) {
      return !String(data && data.jiraEmail || '').trim();
    },
    hasSourceKeys(state) {
      return !!(state.creds && String(state.creds.email || '').trim());
    },
  },
  {
    page: 'connector',
    file: 'connector.json',
    extract(state) {
      const connector = state.connector && typeof state.connector === 'object' ? state.connector : {
        releases: [],
        projects: null,
        scheduleReleases: [],
        scheduleEnabled: false,
        intervals: {},
        lastRun: {},
      };
      return cloneJson(connector);
    },
    apply(state, data) {
      state.connector = cloneJson(asObject(data));
    },
    strip(state) {
      delete state.connector;
    },
    isEmpty(data) {
      return Object.keys(asObject(data)).length === 0;
    },
    hasSourceKeys(state) {
      return Object.prototype.hasOwnProperty.call(asObject(state), 'connector');
    },
  },
  {
    page: 'projects-config',
    file: 'projects.json',
    keys: ['customProjects', 'projectSettings'],
    defaults() {
      return { customProjects: [], projectSettings: {} };
    },
  },
  {
    page: 'releases-config',
    file: 'releases.json',
    keys: ['releases', 'milestones'],
    defaults() {
      return { releases: [], milestones: [] };
    },
  },
  {
    page: 'fields',
    file: 'fields.json',
    keys: ['enabled', 'customIds'],
    defaults() {
      return { enabled: [], customIds: {} };
    },
  },
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fillGenericPage(page) {
  if (page.extract) return page;
  const defaults = typeof page.defaults === 'function' ? page.defaults : () => {
    const out = {};
    (page.keys || []).forEach(key => { out[key] = undefined; });
    return out;
  };
  page.extract = function extract(state) {
    const base = defaults();
    (page.keys || []).forEach(key => {
      if (state[key] !== undefined) base[key] = cloneJson(state[key]);
    });
    return base;
  };
  page.apply = function apply(state, data) {
    const src = asObject(data);
    const base = defaults();
    Object.keys(base).forEach(key => {
      state[key] = src[key] !== undefined ? cloneJson(src[key]) : cloneJson(base[key]);
    });
  };
  page.strip = function strip(state) {
    (page.keys || []).forEach(key => { delete state[key]; });
  };
  page.isEmpty = function isEmpty(data) {
    const src = asObject(data);
    return (page.keys || []).every(key => {
      const value = src[key];
      if (value == null) return true;
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === 'object') return Object.keys(value).length === 0;
      return false;
    });
  };
  page.hasSourceKeys = function hasSourceKeys(state) {
    return (page.keys || []).some(key => Object.prototype.hasOwnProperty.call(state, key));
  };
  return page;
}

PAGE_CONFIGS.forEach(fillGenericPage);

function atomicWritePrettyJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return { missing: true, data: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { missing: false, data: asObject(parsed) };
  } catch (err) {
    const backup = filePath + '.corrupt-' + Date.now();
    try { fs.copyFileSync(filePath, backup); } catch (_) { /* ignore */ }
    return {
      missing: false,
      data: null,
      error: 'Config file ' + path.basename(filePath) + ' is unreadable. A backup was saved as ' + path.basename(backup),
    };
  }
}

function createPageConfig(options) {
  const configDir = options.configDir;
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  function fileFor(page) {
    return path.join(configDir, page.file);
  }

  function writeIfChanged(filePath, value) {
    const next = JSON.stringify(value, null, 2) + '\n';
    if (fs.existsSync(filePath)) {
      try {
        if (fs.readFileSync(filePath, 'utf8') === next) return false;
      } catch (_) { /* rewrite */ }
    }
    atomicWritePrettyJson(filePath, value);
    return true;
  }

  function writeFromState(state, opts) {
    const createMissing = !opts || opts.createMissing !== false;
    const overwrite = !opts || opts.overwrite !== false;
    const source = asObject(state);
    const written = [];
    PAGE_CONFIGS.forEach(page => {
      const slice = page.extract(source);
      const filePath = fileFor(page);
      const exists = fs.existsSync(filePath);
      if (exists && !overwrite) return;
      if (!exists && !createMissing && !page.hasSourceKeys(source)) return;
      writeIfChanged(filePath, slice);
      written.push(page.file);
    });
    return written;
  }

  function mergeIntoState(state) {
    const merged = { ...asObject(state) };
    const errors = [];
    PAGE_CONFIGS.forEach(page => {
      const result = readJsonFile(fileFor(page));
      if (result.error) errors.push(result.error);
      if (result.missing || !result.data) return;
      page.apply(merged, result.data);
    });
    if (errors.length) merged._pageConfigErrors = errors;
    return merged;
  }

  function stripFromState(state) {
    const stripped = { ...asObject(state) };
    PAGE_CONFIGS.forEach(page => {
      if (typeof page.strip === 'function') page.strip(stripped);
    });
    delete stripped._pageConfigErrors;
    return stripped;
  }

  function hasPageKeys(state) {
    const source = asObject(state);
    return PAGE_CONFIGS.some(page => page.hasSourceKeys(source));
  }

  function migrateFromStore(state) {
    const source = asObject(state);
    writeFromState(source, { createMissing: false, overwrite: false });
    return mergeIntoState(source);
  }

  return {
    configDir,
    pages: PAGE_CONFIGS,
    writeFromState,
    mergeIntoState,
    stripFromState,
    hasPageKeys,
    migrateFromStore,
  };
}

module.exports = { createPageConfig, PAGE_CONFIGS };
