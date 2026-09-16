/**
 * Daily Progress forward/backward classification.
 * Run: node scripts/test-status-pipeline.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
assert.ok(
  html.includes('{ re: /creating/i, rank: 5 }'),
  'dashboard.html must rank Creating (including PQA/EOA-Creating) before /^pqa/'
);

const STATUS_PIPELINE_STAGES = [
  { re: /creating/i, rank: 5 },
  { re: /^prod/i, rank: 10 },
  { re: /^dev[\s-]*(pending|grooming|designing)/i, rank: 25 },
  { re: /^dev[\s-]*(developing|cr|merge|reopened)/i, rank: 30 },
  { re: /^on[\s-]*hold/i, rank: 35 },
  { re: /^(eoa[\s-]*pending|pending[\s-]*dep)/i, rank: 40 },
  { re: /^pqa/i, rank: 50 },
  { re: /^qa/i, rank: 55 },
  { re: /^(rejected|replied)/i, rank: 58 },
  { re: /^(closed|done|resolved|cancelled|won't\s*fix)/i, rank: 70 },
];

const LOG_PHASE_ORDER = ['Product', 'Developer Pending', 'Developing', 'QA', 'Rejected / Replied', 'Closed'];

function getStatusPipelineRank(statusName) {
  const s = (statusName || '').trim();
  if (!s) return null;
  for (const stage of STATUS_PIPELINE_STAGES) {
    if (stage.re.test(s)) return stage.rank;
  }
  return null;
}

function getLogMovementDirection(fromPhase, toPhase, fromStatus, toStatus) {
  const fromRank = getStatusPipelineRank(fromStatus);
  const toRank = getStatusPipelineRank(toStatus);
  if (fromRank != null && toRank != null) {
    if (toRank > fromRank) return 'forward';
    if (toRank < fromRank) return 'backward';
    return 'lateral';
  }
  const fromIdx = LOG_PHASE_ORDER.indexOf(fromPhase);
  const toIdx = LOG_PHASE_ORDER.indexOf(toPhase);
  if (fromIdx < 0 || toIdx < 0) return 'other';
  if (toIdx > fromIdx) return 'forward';
  if (toIdx < fromIdx) return 'backward';
  return 'lateral';
}

assert.strictEqual(
  getLogMovementDirection('QA', 'Developer Pending', 'PQA/EOA-Creating', 'Dev-Pending'),
  'forward',
  'PQA/EOA-Creating → Dev-Pending is forward'
);
assert.strictEqual(
  getLogMovementDirection('Product', 'Developer Pending', 'Creating', 'Dev-Pending'),
  'forward'
);
assert.strictEqual(
  getLogMovementDirection('QA', 'QA', 'EOA-Pending Deployment', 'PQA-Pending'),
  'forward'
);
assert.strictEqual(
  getLogMovementDirection('QA', 'Developer Pending', 'PQA-Pending', 'Dev-Pending'),
  'backward'
);
assert.strictEqual(getStatusPipelineRank('PQA/EOA-Creating'), 5);
assert.strictEqual(getStatusPipelineRank('PQA-Pending'), 50);

console.log('status-pipeline: ok');
