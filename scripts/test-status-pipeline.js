/**
 * Daily Progress forward/backward classification from config/status-pipeline.json.
 * Run: node scripts/test-status-pipeline.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FILE_NAME,
  compileStages,
  ensureStatusPipelineFile,
  loadStatusPipeline,
  getStatusPipelineRank,
  getLogMovementDirection,
} = require('../lib/status-pipeline');

const configDir = path.join(__dirname, '..', 'config');
const filePath = path.join(configDir, FILE_NAME);
assert.ok(fs.existsSync(filePath), 'config/status-pipeline.json must exist');
JSON.parse(fs.readFileSync(filePath, 'utf8'));

const loaded = loadStatusPipeline(configDir);
assert.ok(!loaded.error, loaded.error);
const stages = loaded.stages;
const phaseOrder = ['Product', 'Developer Pending', 'Developing', 'QA', 'Rejected / Replied', 'Closed'];

function dir(fromPhase, toPhase, fromStatus, toStatus) {
  return getLogMovementDirection(fromPhase, toPhase, fromStatus, toStatus, stages, phaseOrder);
}

assert.strictEqual(dir('QA', 'Developer Pending', 'PQA/EOA-Creating', 'Dev-Pending'), 'forward');
assert.strictEqual(dir('Product', 'Developer Pending', 'Creating', 'Dev-Pending'), 'forward');
assert.strictEqual(dir('QA', 'QA', 'EOA-Pending Deployment', 'PQA-Pending'), 'forward');
assert.strictEqual(dir('QA', 'Developer Pending', 'PQA-Pending', 'Dev-Pending'), 'backward');
assert.strictEqual(dir('Developer Pending', 'Developing', 'Dev-Pending', 'Dev-Grooming'), 'lateral');
assert.strictEqual(getStatusPipelineRank('PQA/EOA-Creating', stages), 5);
assert.strictEqual(getStatusPipelineRank('PQA-Pending', stages), 50);

const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
assert.ok(html.includes('/config/status-pipeline'));
assert.ok(html.includes('compileStatusPipelineStages'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-dashboard-status-pipeline-'));
ensureStatusPipelineFile(tmpDir);
assert.ok(fs.existsSync(path.join(tmpDir, FILE_NAME)));
const custom = path.join(tmpDir, FILE_NAME);
fs.writeFileSync(custom, JSON.stringify({
  stages: [
    { rank: 1, match: '^start' },
    { rank: 9, match: '^end' },
  ],
}, null, 2) + '\n');
const customLoaded = loadStatusPipeline(tmpDir);
assert.strictEqual(
  getLogMovementDirection('', '', 'Start', 'End', customLoaded.stages, []),
  'forward'
);
assert.strictEqual(compileStages([{ match: '[', rank: 1 }, { match: 'ok', rank: 2 }]).length, 1);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('status-pipeline: ok');
