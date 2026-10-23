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

  async function assertFresh(creds, issueKey, updated) {
    if (!updated || typeof updated !== 'string' || updated.length > 64) {
      throw bad('Refresh this release before editing. The ticket has no updated time.');
    }
    const current = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '?fields=updated');
    if (!current.ok) throw jiraFail(current);
    const live = current.json && current.json.fields && current.json.fields.updated;
    if (!sameUpdated(updated, live)) {
      throw httpError('This ticket changed in Jira. Refresh and try again.', 409, { updated: live || '' });
    }
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

    async issueBrief(creds, key) {
      const issueKey = assertIssueKey(key);
      const res = await jiraFetch(creds, 'GET', '/rest/api/3/issue/' + issueKey + '?fields=summary,issuetype,status,updated');
      if (!res.ok) throw jiraFail(res);
      const fields = (res.json && res.json.fields) || {};
      return {
        key: issueKey,
        summary: fields.summary || '',
        type: (fields.issuetype && fields.issuetype.name) || '',
        status: (fields.status && fields.status.name) || '',
        updated: fields.updated || '',
      };
    },

    async applyChange(creds, key, body) {
      const issueKey = assertIssueKey(key);
      const plan = normalizeChange(body && body.change);
      await assertFresh(creds, issueKey, body && body.updated);
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
  assertIssueKey,
  replaceIssueInState,
  findIssueInState,
  trimTransitions,
  trimFieldMeta,
  trimUsers,
  trimVersions,
  jiraErrorMessage,
  plainTextAdf,
};
