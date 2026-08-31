/**
 * Shrink dashboard state before it is POSTed or written to data/store.json.
 * Synced Jira issues include descriptions, avatars, and full changelogs that
 * quickly exceed Express's JSON body limit and bloat the local store.
 */

'use strict';

const DROP_FIELD_KEYS = new Set([
  'description',
  'comment',
  'comments',
  'attachment',
  'worklog',
  'environment',
  'thumbnail',
  'watches',
  'votes',
  'issuerestriction',
  'timetracking',
  'aggregatetimeoriginalestimate',
  'aggregatetimeestimate',
  'aggregatetimespent',
  'timeoriginalestimate',
  'timeestimate',
  'timespent',
  'progress',
  'aggregateprogress',
  'workratio',
  'lastviewed',
  'security',
]);

const DROP_OBJECT_KEYS = new Set(['avatarUrls', 'self', 'iconUrl', 'iconUrls']);

function slimValue(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map(v => slimValue(v, depth + 1));
  const out = {};
  Object.entries(value).forEach(([key, nested]) => {
    if (DROP_OBJECT_KEYS.has(key)) return;
    out[key] = slimValue(nested, depth + 1);
  });
  return out;
}

function slimChangelog(changelog) {
  if (!changelog || typeof changelog !== 'object') return changelog;
  const histories = (changelog.histories || [])
    .map(history => {
      const items = (history.items || [])
        .filter(item => item && (item.field === 'status' || item.fieldId === 'status'))
        .map(item => ({
          field: item.field || 'status',
          fieldId: item.fieldId || 'status',
          fromString: item.fromString || '',
          toString: item.toString || '',
        }));
      if (!items.length) return null;
      return { created: history.created, items };
    })
    .filter(Boolean);
  const slimmed = {
    startAt: 0,
    maxResults: histories.length,
    total: histories.length,
    histories,
  };
  if (changelog._source) slimmed._source = changelog._source;
  return slimmed;
}

function slimIssue(issue) {
  if (!issue || typeof issue !== 'object') return issue;
  const src = issue.fields || {};
  const fields = {};
  Object.entries(src).forEach(([key, value]) => {
    if (value == null) return;
    if (DROP_FIELD_KEYS.has(String(key).toLowerCase())) return;
    fields[key] = slimValue(value);
  });
  const out = { key: issue.key, fields };
  if (issue.id != null) out.id = issue.id;
  if (issue.changelog) out.changelog = slimChangelog(issue.changelog);
  return out;
}

function slimProjectCache(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.err && !Array.isArray(data.issues)) return { err: data.err };
  const issues = Array.isArray(data.issues) ? data.issues.map(slimIssue) : [];
  const slimmed = { issues };
  if (data.total != null) slimmed.total = data.total;
  else slimmed.total = issues.length;
  if (data.maxResults != null) slimmed.maxResults = data.maxResults;
  if (data.startAt != null) slimmed.startAt = data.startAt;
  if (data.partial) slimmed.partial = true;
  if (data.err) slimmed.err = data.err;
  return slimmed;
}

function slimReleaseCache(releaseCache) {
  if (!releaseCache || typeof releaseCache !== 'object') return {};
  const out = {};
  Object.entries(releaseCache).forEach(([release, projects]) => {
    if (!projects || typeof projects !== 'object') {
      out[release] = projects;
      return;
    }
    out[release] = {};
    Object.entries(projects).forEach(([projectKey, data]) => {
      out[release][projectKey] = slimProjectCache(data);
    });
  });
  return out;
}

function slimDashboardState(state) {
  if (!state || typeof state !== 'object') return {};
  const releaseCache = state.releaseCache && typeof state.releaseCache === 'object'
    ? { ...state.releaseCache }
    : {};
  if (state.cache && typeof state.cache === 'object' && Object.keys(state.cache).length) {
    const releaseName = state.activeRelease || '';
    const existing = releaseCache[releaseName] && typeof releaseCache[releaseName] === 'object'
      ? releaseCache[releaseName]
      : {};
    releaseCache[releaseName] = { ...existing, ...state.cache };
  }
  const slimmed = { ...state };
  delete slimmed.charts;
  delete slimmed.cache;
  Object.keys(slimmed).forEach(key => {
    if (key.charAt(0) === '_') delete slimmed[key];
  });
  slimmed.releaseCache = slimReleaseCache(releaseCache);
  if (slimmed.creds && typeof slimmed.creds === 'object') {
    slimmed.creds = { ...slimmed.creds };
    delete slimmed.creds.token;
  }
  return slimmed;
}

function dashboardStateForClient(state) {
  const slimmed = slimDashboardState(state);
  const active = slimmed.activeRelease || '';
  slimmed.cache = (slimmed.releaseCache && slimmed.releaseCache[active]) || {};
  return slimmed;
}

module.exports = {
  slimIssue,
  slimChangelog,
  slimProjectCache,
  slimReleaseCache,
  slimDashboardState,
  dashboardStateForClient,
};
