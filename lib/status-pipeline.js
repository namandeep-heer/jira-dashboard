/**
 * Forward / backward movement ranks for Daily Progress.
 * Source of truth: config/status-pipeline.json (pretty-printed, hand-editable).
 * First matching stage wins; higher rank is further along the pipeline.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'status-pipeline.json';

const DEFAULT_STAGES = [
  { id: 'creating', rank: 5, match: 'creating', note: 'Intake, including PQA/EOA-Creating. Not Product QA. Creating → Dev-Pending is forward.' },
  { id: 'prod', rank: 10, match: '^prod' },
  { id: 'dev-queue', rank: 25, match: '^dev[\\s-]*(pending|grooming|designing)', note: 'Dev prep / queue. Pending, Grooming, and Designing are peers (lateral).' },
  { id: 'dev-active', rank: 30, match: '^dev[\\s-]*(developing|cr|merge|reopened)' },
  { id: 'on-hold', rank: 35, match: '^on[\\s-]*hold' },
  { id: 'deploy-queue', rank: 40, match: '^(eoa[\\s-]*pending|pending[\\s-]*dep)', note: 'Still pre–Product QA. EOA-Pending / Pending DEP → PQA-Pending is forward.' },
  { id: 'pqa', rank: 50, match: '^pqa', note: 'Product QA after deployment. Does not match PQA/EOA-Creating because creating is listed first.' },
  { id: 'qa', rank: 55, match: '^qa' },
  { id: 'feedback', rank: 58, match: '^(rejected|replied)', note: 'Rejected and Replied are the same stage (lateral).' },
  { id: 'closed', rank: 70, match: "^(closed|done|resolved|cancelled|won't\\s*fix)" },
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compileStages(stages) {
  if (!Array.isArray(stages)) return [];
  const compiled = [];
  stages.forEach((stage, index) => {
    const src = asObject(stage);
    const match = String(src.match || '').trim();
    const rank = Number(src.rank);
    if (!match || !Number.isFinite(rank)) return;
    try {
      compiled.push({
        id: src.id || ('stage-' + index),
        rank,
        match,
        note: src.note ? String(src.note) : undefined,
        re: new RegExp(match, src.flags || 'i'),
      });
    } catch (_) { /* skip invalid regex */ }
  });
  return compiled;
}

function publicStages(stages) {
  return compileStages(stages).map(stage => ({
    id: stage.id,
    rank: stage.rank,
    match: stage.match,
    ...(stage.note ? { note: stage.note } : {}),
  }));
}

function readPipelineFile(configDir) {
  const filePath = path.join(configDir, FILE_NAME);
  if (!fs.existsSync(filePath)) {
    return { filePath, missing: true, stages: DEFAULT_STAGES };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const stages = asObject(parsed).stages;
    if (!Array.isArray(stages) || !stages.length) {
      return { filePath, missing: false, stages: DEFAULT_STAGES, error: FILE_NAME + ' has no stages; using defaults' };
    }
    return { filePath, missing: false, stages };
  } catch (err) {
    return {
      filePath,
      missing: false,
      stages: DEFAULT_STAGES,
      error: FILE_NAME + ' is not valid JSON (' + (err && err.message ? err.message : 'Invalid JSON') + '); using defaults',
    };
  }
}

function ensureStatusPipelineFile(configDir) {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, FILE_NAME);
  if (fs.existsSync(filePath)) return filePath;
  fs.writeFileSync(filePath, JSON.stringify({ stages: DEFAULT_STAGES }, null, 2) + '\n', 'utf8');
  return filePath;
}

function loadStatusPipeline(configDir) {
  const loaded = readPipelineFile(configDir);
  const compiled = compileStages(loaded.stages);
  return {
    filePath: loaded.filePath,
    error: loaded.error,
    stages: compiled.length ? compiled : compileStages(DEFAULT_STAGES),
    public: { stages: publicStages(compiled.length ? loaded.stages : DEFAULT_STAGES) },
  };
}

function getStatusPipelineRank(statusName, stages) {
  const s = String(statusName || '').trim();
  if (!s) return null;
  for (let i = 0; i < (stages || []).length; i++) {
    const stage = stages[i];
    if (stage && stage.re && stage.re.test(s)) return stage.rank;
  }
  return null;
}

function getLogMovementDirection(fromPhase, toPhase, fromStatus, toStatus, stages, phaseOrder) {
  const fromRank = getStatusPipelineRank(fromStatus, stages);
  const toRank = getStatusPipelineRank(toStatus, stages);
  if (fromRank != null && toRank != null) {
    if (toRank > fromRank) return 'forward';
    if (toRank < fromRank) return 'backward';
    return 'lateral';
  }
  const order = Array.isArray(phaseOrder) ? phaseOrder : [];
  const fromIdx = order.indexOf(fromPhase);
  const toIdx = order.indexOf(toPhase);
  if (fromIdx < 0 || toIdx < 0) return 'other';
  if (toIdx > fromIdx) return 'forward';
  if (toIdx < fromIdx) return 'backward';
  return 'lateral';
}

module.exports = {
  FILE_NAME,
  DEFAULT_STAGES,
  compileStages,
  ensureStatusPipelineFile,
  loadStatusPipeline,
  getStatusPipelineRank,
  getLogMovementDirection,
};
