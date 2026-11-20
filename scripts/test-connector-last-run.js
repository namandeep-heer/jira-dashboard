/**
 * Unit tests for local connector last-run timestamps.
 * Run: node scripts/test-connector-last-run.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConnectorLastRun } = require('../lib/connector-last-run');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-connector-last-run-'));
const filePath = path.join(tmpDir, 'connector-last-run.json');
const runs = createConnectorLastRun({ filePath });

assert.deepStrictEqual(runs.load(), {});
runs.save({ 'N2026.R2': 100, '': 5, Bad: 'nope', 'N2027.R1': 200.5 });
assert.deepStrictEqual(runs.load(), { 'N2026.R2': 100, 'N2027.R1': 200.5 });

const connectorPath = path.join(tmpDir, 'connector.json');
fs.writeFileSync(connectorPath, JSON.stringify({
  releases: ['N2026.R2'],
  lastRun: { 'N2026.R2': 999, skip: -1 },
  scheduleEnabled: true,
}, null, 2) + '\n', 'utf8');
const kept = createConnectorLastRun({ filePath: path.join(tmpDir, 'fresh.json') });
assert.deepStrictEqual(kept.migrateFromConnectorFile(connectorPath), { 'N2026.R2': 999 });
const stripped = JSON.parse(fs.readFileSync(connectorPath, 'utf8'));
assert.deepStrictEqual(stripped.releases, ['N2026.R2']);
assert.strictEqual(stripped.scheduleEnabled, true);
assert.ok(!('lastRun' in stripped));

fs.writeFileSync(connectorPath, JSON.stringify({
  releases: ['N2026.R2'],
  lastRun: { 'N2026.R2': 1 },
}, null, 2) + '\n', 'utf8');
assert.deepStrictEqual(kept.migrateFromConnectorFile(connectorPath), { 'N2026.R2': 999 });
assert.ok(!('lastRun' in JSON.parse(fs.readFileSync(connectorPath, 'utf8'))));
fs.writeFileSync(connectorPath, JSON.stringify({
  releases: ['N2026.R2'],
  lastRun: { 'N2026.R2': 1500, 'N2027.R1': 40 },
}, null, 2) + '\n', 'utf8');
assert.deepStrictEqual(kept.migrateFromConnectorFile(connectorPath), { 'N2026.R2': 1500, 'N2027.R1': 40 });
assert.ok(!('lastRun' in JSON.parse(fs.readFileSync(connectorPath, 'utf8'))));

const state = { connector: { releases: ['N2026.R2'], lastRun: { 'N2026.R2': 50 } } };
kept.rememberFromState(state);
assert.deepStrictEqual(kept.load(), { 'N2026.R2': 50 });
const attached = kept.attach({ connector: { releases: ['N2026.R2'] } });
assert.deepStrictEqual(attached.connector.lastRun, { 'N2026.R2': 50 });
kept.rememberFromState({ page: 'setup' });
assert.deepStrictEqual(kept.load(), { 'N2026.R2': 50 });

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('connector-last-run: ok');
