/**
 * Unit tests for per-page config JSON files under config/.
 * Run: node scripts/test-page-config.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPageConfig, PAGE_CONFIGS } = require('../lib/page-config');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-page-config-'));
const pageConfig = createPageConfig({ configDir: tmpDir });

assert.deepStrictEqual(
  PAGE_CONFIGS.map(page => page.file),
  ['setup.json', 'connector.json', 'projects.json', 'releases.json', 'fields.json']
);

const state = {
  page: 'projects-config',
  creds: { url: 'https://example.atlassian.net', email: 'admin@example.com', token: 'secret-token' },
  customProjects: [{ key: 'NEW', jql: 'project = NEW' }],
  projectSettings: { NFS: { jql: 'project = NFS AND issuetype = Bug' } },
  releases: [{ name: 'N2026.R1', patches: ['N2026.R1.P1'] }],
  milestones: [{ id: 'sc', label: 'Scope Complete' }],
  enabled: ['key', 'summary'],
  customIds: { cf_devest: 'customfield_10204' },
  connector: { releases: ['N2026.R1'], scheduleEnabled: true, intervals: { 'N2026.R1': 60 } },
  cache: { NFS: { issues: [] } },
  activeRelease: 'N2026.R1',
};

pageConfig.writeFromState(state);

const projectsPath = path.join(tmpDir, 'projects.json');
const projectsRaw = fs.readFileSync(projectsPath, 'utf8');
assert.ok(projectsRaw.startsWith('{\n'));
assert.ok(projectsRaw.endsWith('\n'));
const projects = JSON.parse(projectsRaw);
assert.strictEqual(projects.customProjects[0].key, 'NEW');
assert.strictEqual(projects.projectSettings.NFS.jql, 'project = NFS AND issuetype = Bug');

const setup = JSON.parse(fs.readFileSync(path.join(tmpDir, 'setup.json'), 'utf8'));
assert.strictEqual(setup.jiraEmail, 'admin@example.com');
assert.ok(!('token' in setup));
assert.ok(!JSON.stringify(setup).includes('secret-token'));

const fields = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fields.json'), 'utf8'));
assert.deepStrictEqual(fields.enabled, ['key', 'summary']);
assert.strictEqual(fields.customIds.cf_devest, 'customfield_10204');

const connector = JSON.parse(fs.readFileSync(path.join(tmpDir, 'connector.json'), 'utf8'));
assert.strictEqual(connector.scheduleEnabled, true);
assert.deepStrictEqual(connector.releases, ['N2026.R1']);
assert.ok(!('connector' in connector));

const stripped = pageConfig.stripFromState(state);
assert.ok(!stripped.customProjects);
assert.ok(!stripped.projectSettings);
assert.ok(!stripped.releases);
assert.ok(!stripped.milestones);
assert.ok(!stripped.enabled);
assert.ok(!stripped.customIds);
assert.ok(!stripped.connector);
assert.strictEqual(stripped.activeRelease, 'N2026.R1');
assert.ok(stripped.cache);
assert.strictEqual(stripped.creds.token, 'secret-token');

const merged = pageConfig.mergeIntoState(stripped);
assert.strictEqual(merged.projectSettings.NFS.jql, 'project = NFS AND issuetype = Bug');
assert.strictEqual(merged.releases[0].name, 'N2026.R1');
assert.strictEqual(merged.connector.scheduleEnabled, true);
assert.strictEqual(merged.creds.email, 'admin@example.com');
assert.strictEqual(merged.creds.token, 'secret-token');

const beforeMtime = fs.statSync(projectsPath).mtimeMs;
pageConfig.writeFromState(state);
assert.strictEqual(fs.statSync(projectsPath).mtimeMs, beforeMtime);

const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-page-config-migrate-'));
const migrator = createPageConfig({ configDir: otherDir });
const existing = path.join(otherDir, 'projects.json');
fs.writeFileSync(existing, JSON.stringify({
  customProjects: [{ key: 'FROMFILE' }],
  projectSettings: { FCO: { jql: 'project = FCO' } },
}, null, 2) + '\n');
migrator.migrateFromStore({
  customProjects: [{ key: 'FROMSTORE' }],
  projectSettings: { NFS: { jql: 'from-store' } },
  releases: [{ name: 'N2026.R2' }],
});
assert.strictEqual(JSON.parse(fs.readFileSync(existing, 'utf8')).customProjects[0].key, 'FROMFILE');
assert.strictEqual(
  JSON.parse(fs.readFileSync(path.join(otherDir, 'releases.json'), 'utf8')).releases[0].name,
  'N2026.R2'
);
assert.ok(!fs.existsSync(path.join(otherDir, 'fields.json')));

const mergedAfterMigrate = migrator.mergeIntoState({
  customProjects: [{ key: 'FROMSTORE' }],
  projectSettings: { NFS: { jql: 'from-store' } },
});
assert.strictEqual(mergedAfterMigrate.customProjects[0].key, 'FROMFILE');
assert.strictEqual(mergedAfterMigrate.projectSettings.FCO.jql, 'project = FCO');
assert.ok(!mergedAfterMigrate.projectSettings.NFS);

const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-page-config-corrupt-'));
const corruptor = createPageConfig({ configDir: corruptDir });
fs.writeFileSync(path.join(corruptDir, 'fields.json'), '{ not json', 'utf8');
const recovered = corruptor.mergeIntoState({ enabled: ['summary'] });
assert.deepStrictEqual(recovered.enabled, ['summary']);
assert.ok(recovered._pageConfigErrors.some(msg => msg.includes('fields.json')));
assert.ok(fs.readdirSync(corruptDir).some(name => name.startsWith('fields.json.corrupt-')));

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(otherDir, { recursive: true, force: true });
fs.rmSync(corruptDir, { recursive: true, force: true });
console.log('page-config: ok');
