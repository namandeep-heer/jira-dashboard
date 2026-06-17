const PHASES = [
  { label: 'Product', re: /^prod/i },
  { label: 'Developer Pending', re: /^dev[\s-]*pending/i },
  { label: 'Developing', re: /^dev[\s-]*(developing|designing|grooming|cr|merge|reopened)/i },
  { label: 'QA', re: /^(qa|pqa|pending[\s-]*dep|eoa[\s-]*pending)/i },
  { label: 'Closed', re: /^(closed|done|resolved|cancelled|won't\s*fix)/i },
];

// Dev still in progress — actual days not required yet.
// Matches pre-QA statuses used in Open Bugs JQL (projects.default.json).
const DEV_ACTIVE_STATUS_RES = [
  /^prod/i,
  /^dev[\s-]*(pending|developing|designing|grooming|cr|merge|reopened)/i,
  /^on[\s-]*hold/i,
];

const DATA_GAPS_SKIP_STATUS_RES = [/^creating$/i];

const DEFAULT_FIELD_EST = 'customfield_10204';
const DEFAULT_FIELD_ACT = 'customfield_10203';

function getPhase(statusName) {
  return PHASES.find(p => p.re.test((statusName || '').trim())) || null;
}

function toDayNumber(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (Array.isArray(val)) return toDayNumber(val[0]);
  const raw = String(val).trim().replace(',', '.');
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

function shouldSkipDataGapsTicket(statusName) {
  const s = (statusName || '').trim();
  if (!s) return true;
  return DATA_GAPS_SKIP_STATUS_RES.some(re => re.test(s));
}

function isDevWorkComplete(statusName) {
  const s = (statusName || '').trim();
  if (!s) return false;
  return !DEV_ACTIVE_STATUS_RES.some(re => re.test(s));
}

function getIssueDays(fields, fieldId) {
  return toDayNumber(fields?.[fieldId]);
}

function analyzeIssue(issue, fieldEst = DEFAULT_FIELD_EST, fieldAct = DEFAULT_FIELD_ACT) {
  const fields = issue.fields || {};
  const status = fields.status?.name || '';
  const estimate = getIssueDays(fields, fieldEst);
  const actual = getIssueDays(fields, fieldAct);
  const phase = getPhase(status);
  const devComplete = isDevWorkComplete(status);

  return {
    key: issue.key,
    status,
    phase: phase?.label || 'Other',
    estimate,
    actual,
    missingEstimate: estimate === 0,
    missingActual: actual === 0,
    devComplete,
    missingActualAfterDevComplete: actual === 0 && devComplete,
    stillInDevWithMissingActual: actual === 0 && !devComplete,
  };
}

function analyzeCache(cache, fieldEst = DEFAULT_FIELD_EST, fieldAct = DEFAULT_FIELD_ACT) {
  const missingEstimate = [];
  const devCompleteMissingActual = [];
  const inDevMissingActual = [];
  const byStatusMissingActual = {};
  const byStatusMissingActualAfterDev = {};

  Object.entries(cache || {}).forEach(([projKey, data]) => {
    if (!data || data.err) return;
    (data.issues || []).forEach(issue => {
      const status = issue.fields?.status?.name || '';
      if (shouldSkipDataGapsTicket(status)) return;
      const row = { ...analyzeIssue(issue, fieldEst, fieldAct), project: projKey };
      if (row.missingEstimate) missingEstimate.push(row);
      if (row.missingActual) {
        byStatusMissingActual[row.status] = (byStatusMissingActual[row.status] || 0) + 1;
        if (row.devComplete) {
          devCompleteMissingActual.push(row);
          byStatusMissingActualAfterDev[row.status] = (byStatusMissingActualAfterDev[row.status] || 0) + 1;
        } else if (row.stillInDevWithMissingActual) {
          inDevMissingActual.push(row);
        }
      }
    });
  });

  return {
    totalIssues: Object.values(cache || {}).reduce((n, d) => n + ((d && !d.err && d.issues) ? d.issues.length : 0), 0),
    missingEstimate: missingEstimate.length,
    devCompleteMissingActual: devCompleteMissingActual.length,
    inDevMissingActual: inDevMissingActual.length,
    byStatusMissingActual,
    byStatusMissingActualAfterDev,
    samples: {
      devCompleteMissingActual: devCompleteMissingActual.slice(0, 10),
      inDevMissingActual: inDevMissingActual.slice(0, 10),
    },
  };
}

module.exports = {
  PHASES,
  DEV_ACTIVE_STATUS_RES,
  DATA_GAPS_SKIP_STATUS_RES,
  getPhase,
  toDayNumber,
  shouldSkipDataGapsTicket,
  isDevWorkComplete,
  analyzeIssue,
  analyzeCache,
};