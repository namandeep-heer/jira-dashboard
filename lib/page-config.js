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
    merge(existing, incoming) {
      return {
        customProjects: incoming.customProjects !== undefined
          ? cloneJson(incoming.customProjects)
          : cloneJson(existing.customProjects),
        projectSettings: mergeProjectSettingsMaps(existing.projectSettings, incoming.projectSettings),
      };
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

function isSkeletonProjectSetting(setting) {
  const src = asObject(setting);
  const keys = Object.keys(src);
  if (!keys.length) return true;
  if (!keys.every(key => key === 'releaseMode' || key === 'releases')) return false;
  return !Array.isArray(src.releases) || src.releases.length === 0;
}

function mergeProjectSettingsMaps(existing, incoming) {
  const prev = asObject(existing);
  const next = asObject(incoming);
  const out = cloneJson(prev);
  Object.keys(next).forEach(key => {
    const incomingSetting = next[key];
    const existingSetting = prev[key];
    const hasExisting = existingSetting && typeof existingSetting === 'object' && !Array.isArray(existingSetting);
    if (!hasExisting) {
      out[key] = cloneJson(incomingSetting);
      return;
    }
    if (isSkeletonProjectSetting(incomingSetting) && !isSkeletonProjectSetting(existingSetting)) {
      return;
    }
    const incomingObj = asObject(incomingSetting);
    const existingObj = asObject(existingSetting);
    const merged = { ...cloneJson(existingObj), ...cloneJson(incomingObj) };
    if (!incomingObj.jql && existingObj.jql) merged.jql = existingObj.jql;
    if (incomingObj.enabled == null && existingObj.enabled != null) merged.enabled = existingObj.enabled;
    if ((!Array.isArray(incomingObj.releases) || incomingObj.releases.length === 0)
      && Array.isArray(existingObj.releases) && existingObj.releases.length) {
      merged.releases = cloneJson(existingObj.releases);
    }
    if (!incomingObj.releaseMode && existingObj.releaseMode) merged.releaseMode = existingObj.releaseMode;
    out[key] = merged;
  });
  return out;
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

function createPageConfig(options) {
  const configDir = options.configDir;
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const unreadableBackups = new Map();

  function fileFor(page) {
    return path.join(configDir, page.file);
  }

  function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return { missing: true, data: null };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { missing: false, data: asObject(parsed) };
    } catch (err) {
      const detail = err && err.message ? err.message : 'Invalid JSON';
      if (!unreadableBackups.has(filePath)) {
        const backup = filePath + '.corrupt-' + Date.now();
        try { fs.copyFileSync(filePath, backup); } catch (_) { /* ignore */ }
        unreadableBackups.set(filePath, path.basename(backup));
      }
      return {
        missing: false,
        data: null,
        unreadable: true,
        error: 'Config file ' + path.basename(filePath)
          + ' is not valid JSON (' + detail + '). Quotes inside JQL must be escaped as \\".'
          + ' The original file was left in place; a backup was saved as '
          + unreadableBackups.get(filePath),
      };
    }
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
      let slice = page.extract(source);
      const filePath = fileFor(page);
      const exists = fs.existsSync(filePath);
      if (exists) {
        const current = readJsonFile(filePath);
        if (current.unreadable) return;
        if (!overwrite) return;
        if (page.isEmpty(slice) && current.data && !page.isEmpty(current.data)) return;
        if (typeof page.merge === 'function' && current.data) slice = page.merge(current.data, slice);
      }
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
