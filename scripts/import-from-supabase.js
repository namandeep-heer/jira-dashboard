/**
 * One-time import of dashboard data from a Supabase project into data/store.json.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-from-supabase.js
 *
 * Passwords cannot be imported (Supabase Auth hashes are not recoverable).
 * After import, create a local account with ADMIN_EMAIL to use the workspace.
 */

'use strict';

const path = require('path');
const fetch = require('node-fetch');
const { createLocalStore } = require('../lib/local-store');
const { createPageConfig } = require('../lib/page-config');

const ROOT = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((env, line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    return env;
  }, {});
}

const localEnv = loadEnvFile(path.join(ROOT, 'config', '.env'));
const supabaseUrl = String(process.env.SUPABASE_URL || localEnv.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY || '';
const encryptionKey = process.env.JIRA_CREDENTIAL_ENCRYPTION_KEY || localEnv.JIRA_CREDENTIAL_ENCRYPTION_KEY || '';
const adminEmail = String(process.env.ADMIN_EMAIL || localEnv.ADMIN_EMAIL || '').trim().toLowerCase();

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to import.');
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: 'Bearer ' + serviceKey,
  Accept: 'application/json',
};

async function rest(tableQuery) {
  const response = await fetch(supabaseUrl + '/rest/v1/' + tableQuery, { headers });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch (err) { body = text; }
  if (!response.ok) {
    throw new Error(tableQuery + ' HTTP ' + response.status + ': ' + String(text).slice(0, 400));
  }
  return body;
}

async function authUsers() {
  const response = await fetch(supabaseUrl + '/auth/v1/admin/users?page=1&per_page=1000', { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('auth users HTTP ' + response.status + ': ' + JSON.stringify(body).slice(0, 400));
  }
  return body.users || body || [];
}

function summarizeState(state) {
  if (!state || typeof state !== 'object') return { keys: 0 };
  const cacheKeys = state.cache && typeof state.cache === 'object' ? Object.keys(state.cache).length : 0;
  const releaseCache = state.releaseCache && typeof state.releaseCache === 'object' ? Object.keys(state.releaseCache).length : 0;
  return {
    keys: Object.keys(state).length,
    page: state.page || '',
    releases: Array.isArray(state.releases) ? state.releases.length : 0,
    customProjects: Array.isArray(state.customProjects) ? state.customProjects.length : 0,
    cacheProjects: cacheKeys,
    releaseCaches: releaseCache,
    logEntries: Array.isArray(state.log) ? state.log.length : 0,
  };
}

(async () => {
  const [sharedRows, memberRows, credentialRows, legacyRows, users] = await Promise.all([
    rest('shared_dashboard_state?select=id,state,updated_at&order=updated_at.desc'),
    rest('dashboard_members?select=*'),
    rest('user_jira_credentials?select=*'),
    rest('dashboard_state?select=user_id,state,updated_at&order=updated_at.desc').catch(() => []),
    authUsers().catch(err => {
      console.warn('Auth users unavailable:', err.message);
      return [];
    }),
  ]);

  const shared = Array.isArray(sharedRows) ? sharedRows[0] : null;
  const legacy = Array.isArray(legacyRows) ? legacyRows[0] : null;
  const state = (shared && shared.state && Object.keys(shared.state).length)
    ? shared.state
    : (legacy && legacy.state) || {};
  const source = (shared && shared.state && Object.keys(shared.state).length)
    ? 'shared_dashboard_state'
    : (legacy ? 'dashboard_state' : 'empty');

  const store = createLocalStore({
    dataDir: path.join(ROOT, 'data'),
    encryptionKey,
    adminEmail,
  });
  const { slimDashboardState } = require('../lib/slim-cache');
  const pageConfig = createPageConfig({ configDir: path.join(ROOT, 'config') });
  const slimmed = slimDashboardState(state);
  pageConfig.writeFromState(slimmed);
  store.setSharedState(pageConfig.stripFromState(slimmed));
  (Array.isArray(credentialRows) ? credentialRows : []).forEach(row => {
    store.importEncryptedCredentials({
      jiraUrl: row.jira_url,
      jiraEmail: row.jira_email,
      jiraTokenCiphertext: row.jira_token_ciphertext,
      updatedAt: row.updated_at,
    });
  });

  console.log('Imported from', source);
  console.log('State:', JSON.stringify(summarizeState(state)));
  console.log('Members:', Array.isArray(memberRows) ? memberRows.length : 0);
  console.log('Credentials:', Array.isArray(credentialRows) ? credentialRows.length : 0);
  console.log('Auth users:', Array.isArray(users) ? users.length : 0);
  if (Array.isArray(memberRows) && memberRows.length) {
    memberRows.forEach(row => console.log('  member', row.email, row.role));
  }
  if (Array.isArray(users) && users.length) {
    users.forEach(user => console.log('  user', user.email || user.id));
  }
  console.log('Saved to data/store.json and config/*.json');
  console.log('Passwords were not imported. Create a local account with ADMIN_EMAIL to open the workspace.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
