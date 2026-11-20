/**
 * Per-machine connector schedule timestamps.
 * Kept out of config/connector.json so they are not committed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function normalizeLastRun(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  Object.keys(value).forEach(key => {
    const name = String(key || '').trim();
    const at = Number(value[key]);
    if (!name || !Number.isFinite(at) || at < 0) return;
    out[name] = at;
  });
  return out;
}

function atomicWritePrettyJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + process.pid + '.tmp';
  const text = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

function createConnectorLastRun(options) {
  const filePath = options.filePath;

  function load() {
    if (!fs.existsSync(filePath)) return {};
    try {
      return normalizeLastRun(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (err) {
      return {};
    }
  }

  function save(lastRun) {
    atomicWritePrettyJson(filePath, normalizeLastRun(lastRun));
    return load();
  }

  function rememberFromState(state) {
    const connector = state && state.connector;
    if (!connector || typeof connector !== 'object' || Array.isArray(connector)) return;
    if (!Object.prototype.hasOwnProperty.call(connector, 'lastRun')) return;
    save(connector.lastRun);
  }

  function attach(state) {
    if (!state || !state.connector || typeof state.connector !== 'object' || Array.isArray(state.connector)) {
      return state;
    }
    state.connector.lastRun = load();
    return state;
  }

  function migrateFromConnectorFile(connectorPath) {
    if (!connectorPath || !fs.existsSync(connectorPath)) return load();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(connectorPath, 'utf8'));
    } catch (err) {
      return load();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return load();
    const hadLastRun = Object.prototype.hasOwnProperty.call(parsed, 'lastRun');
    if (!fs.existsSync(filePath) && hadLastRun) save(parsed.lastRun);
    if (!hadLastRun) return load();
    delete parsed.lastRun;
    atomicWritePrettyJson(connectorPath, parsed);
    return load();
  }

  return { filePath, load, save, rememberFromState, attach, migrateFromConnectorFile };
}

module.exports = { createConnectorLastRun, normalizeLastRun };
