/**
 * Session-backed Jira writes for the dashboard.
 * The open /jira-api proxy is not used. Each call uses the signed-in user's token.
 */

'use strict';

const { slimIssue } = require('./slim-cache');

const ISSUE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const CUSTOM_FIELD = /^customfield_\d+$/;
const OPTION_ID = /^[A-Za-z0-9_-]{1,40}$/;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const VERSION_ID = /^\d{1,20}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,10}$/;
const DASHBOARD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,32}$/;
const RELEASE_NAME = /^[^\u0000-\u001f]{1,80}$/;
const CREATE_HANDLED = new Set(['project', 'issuetype', 'summary', 'description', 'parent', 'fixVersions', 'attachment', 'reporter', 'issuelinks']);

function httpError(message, status, extra) {
  const err = new Error(message);
  err.status = status || 400;
  if (extra) Object.assign(err, extra);
  return err;
}

function bad(message) {
  return httpError(message, 400);
}

function assertIssueKey(key) {
  const value = String(key || '').trim().toUpperCase();
  if (!ISSUE_KEY.test(value)) throw bad('Enter a ticket key such as NFS-123.');
  return value;
}

function assertProjectKey(key) {
  const value = String(key || '').trim().toUpperCase();
  if (!PROJECT_KEY.test(value)) throw bad('Choose a Jira project.');
  return value;
}

function assertCustomField(fieldId) {
  const id = String(fieldId || '').trim();
  if (!CUSTOM_FIELD.test(id)) throw bad('That field cannot be edited.');
  return id;
}

function jiraErrorMessage(json, status, text) {
  const msgs = [];
  if (json && Array.isArray(json.errorMessages)) msgs.push(...json.errorMessages);
  if (json && json.errors && typeof json.errors === 'object') {
    Object.entries(json.errors).forEach(([field, message]) => {
      msgs.push(field + ': ' + message);
    });
  }
  if (json && json.message) msgs.push(json.message);
  const clean = msgs.map(item => String(item || '').trim()).filter(Boolean);
  if (clean.length) return clean.join(' ');
  const fallback = String(text || '').trim();
  if (fallback && fallback.length < 300 && fallback.charAt(0) !== '<') return fallback;
  return 'Jira returned HTTP ' + (status || 502) + '.';
}

function jiraFail(res) {
  const status = res && res.status;
  const kept = status === 401 || status === 403 || status === 404 || status === 409;
  return httpError(jiraErrorMessage(res && res.json, status, res && res.text), kept ? status : 502);
}

function plainTextAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text) }] }],
  };
}

function sameUpdated(cached, live) {
  if (!cached || !live) return false;
  if (String(cached) === String(live)) return true;
  const left = Date.parse(cached);
  const right = Date.parse(live);
  return Number.isFinite(left) && left === right;
}

function watchedFieldIds(plan) {
  if (!plan) return [];
  const ids = plan.kind === 'transition' ? ['status'] : Object.keys(plan.fields || {});
  return ids.filter(id => (
    id === 'summary' || id === 'status' || id === 'priority' || id === 'assignee'
    || id === 'parent' || id === 'fixVersions' || CUSTOM_FIELD.test(id)
  ));
}

function valuesMatch(cached, live) {
  if (cached == null && live == null) return true;
  if (cached === '' && live == null) return true;
  if (live === '' && cached == null) return true;
  if (cached == null || live == null) return false;
  if (typeof cached === 'number' || typeof live === 'number') {
    const left = Number(cached);
    const right = Number(live);
    return Number.isFinite(left) && left === right;
  }
  if (typeof cached === 'string' || typeof live === 'string') {
    return String(cached).trim() === String(live).trim();
  }
  if (Array.isArray(cached) || Array.isArray(live)) {
    const ids = list => (Array.isArray(list) ? list : []).map(item => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (item.accountId) return 'user:' + item.accountId;
      if (item.id != null) return 'id:' + item.id;
      if (item.key) return 'key:' + String(item.key).toUpperCase();
      return '';
    }).filter(Boolean).sort().join(',');
    return ids(cached) === ids(live);
  }
  if (typeof cached === 'object' || typeof live === 'object') {
    const left = cached || {};
    const right = live || {};
    if (left.accountId || right.accountId) return String(left.accountId || '') === String(right.accountId || '');
    if (left.key && right.key) return String(left.key).toUpperCase() === String(right.key).toUpperCase();
    if (left.id != null && right.id != null) return String(left.id) === String(right.id);
    const leftValue = left.value != null ? left.value : left.name;
    const rightValue = right.value != null ? right.value : right.name;
    return String(leftValue || '') === String(rightValue || '');
  }
  return cached === live;
}

function slimBriefValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 20).map(slimBriefValue);
  if (typeof value !== 'object') return null;
  if (value.accountId) {
    return { accountId: String(value.accountId), displayName: value.displayName ? String(value.displayName).slice(0, 200) : '' };
  }
  const out = {};
  if (value.id != null) out.id = String(value.id);
  if (value.value != null) out.value = String(value.value).slice(0, 200);
  if (value.name != null) out.name = String(value.name).slice(0, 200);
  if (value.key) out.key = String(value.key);
  return Object.keys(out).length ? out : null;
}

function normalizeChange(change) {
  if (!change || typeof change !== 'object') throw bad('Missing change.');
  const type = String(change.type || '');

  if (type === 'summary') {
    const summary = String(change.summary == null ? '' : change.summary).trim();
    if (!summary || summary.length > 255) throw bad('Summary must be 1–255 characters.');
    return { kind: 'edit', fields: { summary } };
  }

  if (type === 'number') {
    const fieldId = assertCustomField(change.fieldId);
    if (change.value == null || change.value === '') return { kind: 'edit', fields: { [fieldId]: null } };
    const n = Number(change.value);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw bad('Enter a number from 0 to 100000.');
    return { kind: 'edit', fields: { [fieldId]: Math.round(n * 100) / 100 } };
  }

  if (type === 'option') {
    const fieldId = assertCustomField(change.fieldId);
    const optionId = change.optionId == null ? '' : String(change.optionId).trim();
    const optionValue = change.optionValue == null ? '' : String(change.optionValue).trim();
    if (!optionId && !optionValue) return { kind: 'edit', fields: { [fieldId]: null } };
    if (optionId) {
      if (!OPTION_ID.test(optionId)) throw bad('Choose an option from the list.');
      return { kind: 'edit', fields: { [fieldId]: { id: optionId } } };
    }
    if (optionValue.length > 200) throw bad('Choose an option from the list.');
    return { kind: 'edit', fields: { [fieldId]: { value: optionValue } } };
  }

  if (type === 'text') {
    const fieldId = assertCustomField(change.fieldId);
    const text = change.text == null ? '' : String(change.text).trim();
    if (text.length > 2000) throw bad('That text is too long.');
    return { kind: 'edit', fields: { [fieldId]: text || null } };
  }

  if (type === 'priority') {
    const id = String(change.priorityId || '').trim();
    if (!OPTION_ID.test(id)) throw bad('Choose a priority.');
    return { kind: 'edit', fields: { priority: { id } } };
  }

  if (type === 'user') {
    const fieldId = change.fieldId === 'assignee' ? 'assignee' : assertCustomField(change.fieldId);
    const accountId = change.accountId == null ? '' : String(change.accountId).trim();
    if (!accountId) return { kind: 'edit', fields: { [fieldId]: null } };
    if (!ACCOUNT_ID.test(accountId)) throw bad('Choose a person from the list.');
    return { kind: 'edit', fields: { [fieldId]: { accountId } } };
  }

  if (type === 'versions') {
    const versions = Array.isArray(change.versions) ? change.versions : null;
    if (!versions || versions.length > 20) throw bad('Choose up to 20 fix versions.');
    const seen = new Set();
    const fields = [];
    versions.forEach(version => {
      const id = String(version && version.id || '').trim();
      if (!VERSION_ID.test(id) || seen.has(id)) throw bad('Choose fix versions from the list.');
      seen.add(id);
      fields.push({ id });
    });
    return { kind: 'edit', fields: { fixVersions: fields } };
  }

  if (type === 'parent') {
    const parentKey = change.parentKey == null ? '' : String(change.parentKey).trim();
    if (!parentKey) return { kind: 'edit', fields: { parent: null } };
    return { kind: 'edit', fields: { parent: { key: assertIssueKey(parentKey) } } };
  }

  if (type === 'transition') {
    const id = String(change.transitionId || '').trim();
    if (!/^\d{1,20}$/.test(id)) throw bad('Choose a status transition.');
    const body = { transition: { id } };
    if (change.resolutionId != null && String(change.resolutionId).trim()) {
      const resolutionId = String(change.resolutionId).trim();
      if (!OPTION_ID.test(resolutionId)) throw bad('Choose a resolution.');
      body.fields = { resolution: { id: resolutionId } };
    }
    if (change.comment != null && String(change.comment).trim()) {
      const comment = String(change.comment).trim();
      if (comment.length > 2000) throw bad('The transition comment is too long.');
      body.update = { comment: [{ add: { body: plainTextAdf(comment) } }] };
    }
    return { kind: 'transition', body };
  }

  throw bad('That edit is not supported.');
}

function trimTransitions(payload) {
  const transitions = payload && Array.isArray(payload.transitions) ? payload.transitions : [];
  return transitions.map(transition => {
    const fields = [];
    const unsupported = [];
    Object.entries(transition.fields || {}).forEach(([key, field]) => {
      if (!field || !field.required) return;
      if (key === 'resolution') {
        fields.push({
          key,
          name: field.name || 'Resolution',
          required: true,
          kind: 'option',
          allowedValues: (field.allowedValues || []).map(value => ({
            id: value && value.id != null ? String(value.id) : '',
            label: (value && (value.name || value.value)) || '',
          })).filter(value => value.id),
        });
        return;
      }
      if (key === 'comment') {
        fields.push({ key, name: field.name || 'Comment', required: true, kind: 'comment' });
        return;
      }
      unsupported.push(field.name || key);
    });
    return {
      id: String(transition.id),
      name: transition.name || '',
      to: {
        id: transition.to && transition.to.id != null ? String(transition.to.id) : '',
        name: (transition.to && transition.to.name) || '',
      },
      fields,
      unsupported,
    };
  }).filter(transition => transition.id);
}

function trimFieldMeta(editmeta, fieldId) {
  const field = editmeta && editmeta.fields && editmeta.fields[fieldId];
  if (!field) return null;
  const schema = field.schema || {};
  return {
    fieldId,
    name: field.name || fieldId,
    required: !!field.required,
    schemaType: schema.type || '',
    allowedValues: (field.allowedValues || []).slice(0, 200).map(value => ({
      id: value && value.id != null ? String(value.id) : '',
      value: value && value.value != null ? String(value.value) : '',
      name: value && value.name != null ? String(value.name) : '',
    })),
  };
}

function trimUsers(list) {
  return (Array.isArray(list) ? list : [])
    .filter(user => user && user.accountId && user.active !== false)
    .slice(0, 20)
    .map(user => ({
      accountId: String(user.accountId),
      displayName: user.displayName || String(user.accountId),
    }));
}

function trimIssueTypes(list) {
  return (Array.isArray(list) ? list : [])
    .filter(type => type && type.id != null && !type.subtask && (type.hierarchyLevel == null || type.hierarchyLevel >= 0))
    .slice(0, 40)
    .map(type => ({
      id: String(type.id),
      name: type.name || String(type.id),
      description: type.description ? String(type.description).slice(0, 240) : '',
      hierarchyLevel: typeof type.hierarchyLevel === 'number' ? type.hierarchyLevel : 0,
    }));
}

function trimAllowedValues(list) {
  return (Array.isArray(list) ? list : []).slice(0, 80).map(value => ({
    id: value && value.id != null ? String(value.id) : '',
    value: value && value.value != null ? String(value.value) : '',
    name: value && value.name != null ? String(value.name) : '',
  })).filter(value => value.id);
}

function trimCreateFields(list) {
  const fields = [];
  const unsupported = [];
  let descriptionRequired = false;
  let parentRequired = false;
  let fixVersionRequired = false;
  (Array.isArray(list) ? list : []).forEach(field => {
    if (!field || !field.required) return;
    const fieldId = String(field.fieldId || field.key || '');
    if (!fieldId) return;
    if (fieldId === 'description') {
      descriptionRequired = true;
      return;
    }
    if (fieldId === 'parent') {
      parentRequired = true;
      return;
    }
    if (fieldId === 'fixVersions') {
      fixVersionRequired = true;
      return;
    }
    if (CREATE_HANDLED.has(fieldId)) return;
    const schema = field.schema || {};
    const type = schema.type || '';
    if (fieldId === 'priority' || type === 'priority') {
      fields.push({
        fieldId: 'priority',
        name: field.name || 'Priority',
        kind: 'priority',
        allowedValues: trimAllowedValues(field.allowedValues),
      });
      return;
    }
    if (CUSTOM_FIELD.test(fieldId) && (type === 'option' || type === 'string' || type === 'number')) {
      fields.push({
        fieldId,
        name: field.name || fieldId,
        kind: type === 'option' ? 'option' : type,
        allowedValues: type === 'option' ? trimAllowedValues(field.allowedValues) : [],
      });
      return;
    }
    unsupported.push(field.name || fieldId);
  });
  return {
    fields: fields.slice(0, 12),
    unsupported: unsupported.slice(0, 8),
    descriptionRequired,
    parentRequired,
    fixVersionRequired,
  };
}

function normalizeCreateValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100000) throw bad('Enter a number from 0 to 100000.');
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (text.length > 2000) throw bad('That text is too long.');
    return text;
  }
  if (typeof value === 'object' && value.id != null) {
    const id = String(value.id).trim();
    if (!OPTION_ID.test(id)) throw bad('Choose an option from the list.');
    return { id };
  }
  throw bad('That field cannot be set from this form.');
}

function normalizePlaces(places) {
  const list = Array.isArray(places) ? places.slice(0, 8) : [];
  const out = [];
  const seen = new Set();
  list.forEach(place => {
    const release = String(place && place.release || '').trim();
    const dashboardKey = String(place && place.dashboardKey || '').trim();
    if (!RELEASE_NAME.test(release) || !DASHBOARD_KEY.test(dashboardKey)) throw bad('Choose where to show the new ticket.');
    const id = release + '\n' + dashboardKey;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ release, dashboardKey });
  });
  return out;
}

function planCreate(body) {
  if (!body || typeof body !== 'object') throw bad('Missing ticket.');
  const projectKey = assertProjectKey(body.projectKey);
  const issueTypeId = String(body.issueTypeId || '').trim();
  if (!/^\d{1,20}$/.test(issueTypeId)) throw bad('Choose an issue type.');
  const summary = String(body.summary == null ? '' : body.summary).trim();
  if (!summary || summary.length > 255) throw bad('Summary must be 1–255 characters.');
  const fields = {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary,
  };
  const description = body.description == null ? '' : String(body.description);
  if (description.trim()) {
    if (description.length > 8000) throw bad('Description is too long.');
    fields.description = plainTextAdf(description.trim());
  }
  const parentKey = body.parentKey == null ? '' : String(body.parentKey).trim();
  if (parentKey) fields.parent = { key: assertIssueKey(parentKey) };
  const versionId = body.fixVersionId == null ? '' : String(body.fixVersionId).trim();
  if (versionId) {
    if (!VERSION_ID.test(versionId)) throw bad('Choose a fix version.');
    fields.fixVersions = [{ id: versionId }];
  }
  const priorityId = body.priorityId == null ? '' : String(body.priorityId).trim();
  if (priorityId) {
    if (!OPTION_ID.test(priorityId)) throw bad('Choose a priority.');
    fields.priority = { id: priorityId };
  }
  const extras = body.fields && typeof body.fields === 'object' ? body.fields : {};
  Object.keys(extras).slice(0, 20).forEach(fieldId => {
    if (CREATE_HANDLED.has(fieldId) || fieldId === 'priority') return;
    const id = assertCustomField(fieldId);
    const value = normalizeCreateValue(extras[fieldId]);
    if (value != null) fields[id] = value;
  });
  return { fields, places: normalizePlaces(body.places) };
}

function insertIssueIntoState(state, issue, places) {
  if (!state || !issue || !issue.key) return 0;
  if (!state.releaseCache || typeof state.releaseCache !== 'object') state.releaseCache = {};
  const seen = new Set();
  let count = 0;
  (places || []).forEach(place => {
    if (!place || !place.release || !place.dashboardKey) return;
    if (!state.releaseCache[place.release] || typeof state.releaseCache[place.release] !== 'object') {
      state.releaseCache[place.release] = {};
    }
    const projects = state.releaseCache[place.release];
    let bucket = projects[place.dashboardKey];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
      bucket = { issues: [] };
      projects[place.dashboardKey] = bucket;
    }
    if (!Array.isArray(bucket.issues)) bucket.issues = [];
    if (seen.has(bucket.issues)) return;
    seen.add(bucket.issues);
    const index = bucket.issues.findIndex(row => row && row.key === issue.key);
    if (index >= 0) bucket.issues[index] = issue;
    else bucket.issues.unshift(issue);
    bucket.total = bucket.issues.length;
    count += 1;
  });
  return count;
}

function trimVersions(list) {
  return (Array.isArray(list) ? list : [])
    .filter(version => version && version.id != null)
    .map(version => ({
      id: String(version.id),
      name: version.name || String(version.id),
      released: !!version.released,
      archived: !!version.archived,
    }));
}

function walkIssueBuckets(state, visit) {
  if (!state || typeof state !== 'object') return;
  const seen = new Set();
  function walk(projects) {
    if (!projects || typeof projects !== 'object' || seen.has(projects)) return;
    seen.add(projects);
    Object.values(projects).forEach(bucket => {
      const issues = bucket && bucket.issues;
      if (!Array.isArray(issues)) return;
      issues.forEach((issue, index) => visit(issues, index, issue));
    });
  }
  walk(state.cache);
  if (state.releaseCache && typeof state.releaseCache === 'object') {
    Object.values(state.releaseCache).forEach(walk);
  }
}

function findIssueInState(state, key) {
  let found = null;
  walkIssueBuckets(state, (_issues, _index, issue) => {
    if (!found && issue && issue.key === key) found = issue;
  });
  return found;
}

function replaceIssueInState(state, issue) {
  if (!issue || !issue.key) return 0;
  let count = 0;
  walkIssueBuckets(state, (issues, index, row) => {
    if (!row || row.key !== issue.key) return;
    row.id = issue.id || row.id;
    row.fields = issue.fields;
    if (issue.changelog) row.changelog = issue.changelog;
    issues[index] = row;
    count += 1;
  });
  return count;
}

function createJiraWriteApi({ jiraFetch, loadState, saveState }) {
  if (typeof jiraFetch !== 'function') throw new Error('jiraFetch is required');
  if (typeof loadState !== 'function') throw new Error('loadState is required');
  if (typeof saveState !== 'function') throw new Error('saveState is required');

  let tail = Promise.resolve();
  function locked(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function fetchChangelog(creds, issueKey) {
    const histories = [];
    let startAt = 0;
    for (let page = 0; page < 10; page += 1) {
      const res = await jiraFetch(
        creds,
        'GET',
        '/rest/api/3/issue/' + issueKey + '/changelog?startAt=' + startAt + '&maxResults=100'
      );
      if (!res.ok || !res.json) return null;
      const values = Array.isArray(res.json.values) ? res.json.values : [];
      histories.push(...values);
      const total = typeof res.json.total === 'number' ? res.json.total : histories.length;
      if (res.json.isLast === true || !values.length || histories.length >= total) return histories;
      startAt += values.length;
    }
    return null;
  }

  async function refetchIssue(creds, issueKey) {
    const got = await jiraFetch(
      creds,
      'GET',
      '/rest/api/3/issue/' + issueKey + '?fields=' + encodeURIComponent('*navigable')
    );
    if (!got.ok || !got.json) {
      throw httpError('Jira saved the change, but the dashboard could not reload the ticket. Refresh this release.', 502, { wrote: true });
    }
    const histories = await fetchChangelog(creds, issueKey);
    if (histories) {
      got.json.changelog = {
        startAt: 0,
        maxResults: histories.length,
        total: histories.length,
        histories,
      };
    } else {
      const previous = findIssueInState(loadState(), issueKey);
      if (previous && previous.changelog) got.json.changelog = previous.changelog;
    }
    const slimmed = slimIssue(got.json);
    slimmed.key = issueKey;
    return slimmed;
  }

  async function assertFresh(creds, issueKey, updated, plan) {
    if (!updated || typeof updated !== 'string' || updated.length > 64) {
      throw bad('Refresh this release before editing. The ticket has no updated time.');
    }
    const fieldIds = watchedFieldIds(plan);
    const names = ['updated'].concat(fieldIds);
    const current = await jiraFetch(
      creds,
      'GET',
      '/rest/api/3/issue/' + issueKey + '?fields=' + encodeURIComponent(names.join(','))
    );
    if (!current.ok) throw jiraFail(current);
    const liveFields = (current.json && current.json.fields) || {};
    const live = liveFields.updated;
    if (sameUpdated(updated, live)) return;
    const cached = findIssueInState(loadState(), issueKey);
    if (cached && cached.fields && fieldIds.length && fieldIds.every(id => valuesMatch(cached.fields[id], liveFields[id]))) {
      return;
    }
    const slim = {};
    fieldIds.forEach(id => { slim[id] = slimBriefValue(liveFields[id]); });
    throw httpError('This ticket changed in Jira. Save again to replace it.', 409, { updated: live || '', live: slim });
  }

  return {
    async transitions(creds, key) {
      const issueKey = assertIssueKey(key);
      const res = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '/transitions?expand=transitions.fields');
      if (!res.ok) throw jiraFail(res);
      return { transitions: trimTransitions(res.json) };
    },

    async fieldMeta(creds, key, fieldId) {
      const issueKey = assertIssueKey(key);
      const id = fieldId === 'priority' || fieldId === 'summary' || fieldId === 'parent' || fieldId === 'assignee'
        ? fieldId
        : assertCustomField(fieldId);
      const res = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '/editmeta');
      if (!res.ok) throw jiraFail(res);
      const meta = trimFieldMeta(res.json, id);
      if (!meta) throw httpError('You cannot edit this field on this ticket.', 404);
      return meta;
    },

    async versions(creds, key) {
      const issueKey = assertIssueKey(key);
      const issue = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '?fields=project');
      if (!issue.ok) throw jiraFail(issue);
      const projectKey = issue.json && issue.json.fields && issue.json.fields.project && issue.json.fields.project.key;
      if (!projectKey) throw bad('Jira did not return a project for this ticket.');
      const res = await jiraFetch(creds, 'GET', '/rest/api/3/project/' + encodeURIComponent(projectKey) + '/versions');
      if (!res.ok) throw jiraFail(res);
      return { versions: trimVersions(res.json) };
    },

    async users(creds, query) {
      const q = String(query && query.query || '').trim().slice(0, 80);
      const fieldId = query && query.fieldId === 'assignee' ? 'assignee' : assertCustomField(query && query.fieldId);
      const issueKey = query && query.issueKey ? assertIssueKey(query.issueKey) : '';
      let path;
      if (fieldId === 'assignee') {
        if (!issueKey) throw bad('Missing ticket key.');
        path = '/rest/api/3/user/assignable/search?issueKey=' + encodeURIComponent(issueKey)
          + '&maxResults=20&query=' + encodeURIComponent(q);
      } else if (!q) {
        return { users: [] };
      } else {
        path = '/rest/api/3/user/search?maxResults=20&query=' + encodeURIComponent(q);
      }
      const res = await jiraFetch(creds, 'GET', path);
      if (!res.ok) throw jiraFail(res);
      return { users: trimUsers(res.json) };
    },

    async createMeta(creds, projectKey, issueTypeId) {
      const key = assertProjectKey(projectKey);
      if (issueTypeId) {
        const id = String(issueTypeId).trim();
        if (!/^\d{1,20}$/.test(id)) throw bad('Choose an issue type.');
        const fields = [];
        let startAt = 0;
        for (let page = 0; page < 8; page += 1) {
          const res = await jiraFetch(
            creds,
            'GET',
            '/rest/api/3/issue/createmeta/' + encodeURIComponent(key) + '/issuetypes/' + encodeURIComponent(id)
              + '?startAt=' + startAt + '&maxResults=50'
          );
          if (!res.ok) throw jiraFail(res);
          const batch = res.json && (Array.isArray(res.json.fields) ? res.json.fields : (Array.isArray(res.json.values) ? res.json.values : []));
          fields.push(...batch);
          const total = res.json && typeof res.json.total === 'number' ? res.json.total : fields.length;
          if (!batch.length || fields.length >= total || res.json.isLast === true) break;
          startAt += batch.length;
        }
        return trimCreateFields(fields);
      }
      const types = [];
      let startAt = 0;
      const versionsPromise = jiraFetch(creds, 'GET', '/rest/api/3/project/' + encodeURIComponent(key) + '/versions');
      for (let page = 0; page < 5; page += 1) {
        const res = await jiraFetch(
          creds,
          'GET',
          '/rest/api/3/issue/createmeta/' + encodeURIComponent(key) + '/issuetypes?startAt=' + startAt + '&maxResults=50'
        );
        if (!res.ok) throw jiraFail(res);
        const batch = res.json && (res.json.issueTypes || res.json.values);
        const list = Array.isArray(batch) ? batch : [];
        types.push(...list);
        const total = res.json && typeof res.json.total === 'number' ? res.json.total : types.length;
        if (!list.length || types.length >= total || res.json.isLast === true) break;
        startAt += list.length;
      }
      const versions = await versionsPromise;
      if (!versions.ok) throw jiraFail(versions);
      return { issueTypes: trimIssueTypes(types), versions: trimVersions(versions.json) };
    },

    async createIssue(creds, body) {
      const plan = planCreate(body);
      const write = await jiraFetch(creds, 'POST', '/rest/api/3/issue', { fields: plan.fields });
      if (!write.ok) throw jiraFail(write);
      const issueKey = assertIssueKey(write.json && write.json.key);
      const issue = await refetchIssue(creds, issueKey);
      const updatedCache = await locked(() => {
        const state = loadState() || {};
        const count = insertIssueIntoState(state, issue, plan.places);
        if (count) saveState(state);
        return count;
      });
      return { issue, updatedCache };
    },

    async issueBrief(creds, key, fieldId) {
      const issueKey = assertIssueKey(key);
      let extra = '';
      if (fieldId) {
        const id = String(fieldId).trim();
        extra = id === 'summary' || id === 'status' || id === 'priority' || id === 'assignee' || id === 'parent' || id === 'fixVersions'
          ? id
          : assertCustomField(id);
      }
      const names = ['summary', 'issuetype', 'status', 'updated'];
      if (extra && names.indexOf(extra) < 0) names.push(extra);
      const res = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '?fields=' + encodeURIComponent(names.join(',')));
      if (!res.ok) throw jiraFail(res);
      const fields = (res.json && res.json.fields) || {};
      const brief = {
        key: issueKey,
        summary: fields.summary || '',
        type: (fields.issuetype && fields.issuetype.name) || '',
        status: (fields.status && fields.status.name) || '',
        updated: fields.updated || '',
      };
      if (extra === 'summary') brief.field = brief.summary;
      else if (extra === 'status') brief.field = slimBriefValue(fields.status);
      else if (extra) brief.field = slimBriefValue(fields[extra]);
      return brief;
    },

    async applyChange(creds, key, body) {
      const issueKey = assertIssueKey(key);
      const plan = normalizeChange(body && body.change);
      await assertFresh(creds, issueKey, body && body.updated, plan);
      const write = plan.kind === 'edit'
        ? await jiraFetch(creds, 'PUT', '/rest/api/3/issue/' + issueKey, { fields: plan.fields })
        : await jiraFetch(creds, 'POST', '/rest/api/3/issue/' + issueKey + '/transitions', plan.body);
      if (!write.ok) throw jiraFail(write);
      const issue = await refetchIssue(creds, issueKey);
      const updatedCache = await locked(() => {
        const state = loadState() || {};
        const count = replaceIssueInState(state, issue);
        if (count) saveState(state);
        return count;
      });
      return { issue, updatedCache };
    },
  };
}

module.exports = {
  createJiraWriteApi,
  normalizeChange,
  planCreate,
  assertIssueKey,
  replaceIssueInState,
  insertIssueIntoState,
  findIssueInState,
  trimTransitions,
  trimFieldMeta,
  trimIssueTypes,
  trimCreateFields,
  trimUsers,
  trimVersions,
  jiraErrorMessage,
  plainTextAdf,
};
