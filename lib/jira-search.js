/**
 * Pick the dashboard project that should show a live Jira ticket.
 * Browser: window.JiraSearch. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.JiraSearch = api;
})(function () {
  'use strict';

  function issueTypeNamesFromJql(jql) {
    const text = String(jql || '');
    const list = text.match(/issuetype\s+in\s*\(([^)]+)\)/i);
    if (list) {
      return list[1].split(',').map(function (part) {
        return part.replace(/^["'\s]+|["'\s]+$/g, '').trim();
      }).filter(Boolean);
    }
    const quoted = text.match(/issuetype\s*=\s*"([^"]+)"/i) || text.match(/issuetype\s*=\s*'([^']+)'/i);
    if (quoted) return [quoted[1].trim()];
    const plain = text.match(/issuetype\s*=\s*([A-Za-z][A-Za-z0-9 &-]*)/i);
    return plain ? [plain[1].trim()] : [];
  }

  function projectKeysFromJql(jql) {
    const text = String(jql || '');
    const keys = [];
    const seen = Object.create(null);
    function add(raw) {
      const key = String(raw || '').trim().replace(/^["']|["']$/g, '').toUpperCase();
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || seen[key]) return;
      seen[key] = true;
      keys.push(key);
    }
    const listed = text.match(/project\s+in\s*\(([^)]*)\)/i);
    if (listed) listed[1].split(',').forEach(add);
    const exact = /project\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Z][A-Z0-9_]*))/gi;
    let match;
    while ((match = exact.exec(text))) add(match[1] || match[2] || match[3]);
    return keys;
  }

  function issueProjectKey(issue) {
    const key = String(issue && issue.key || '').toUpperCase();
    const match = key.match(/^([A-Z][A-Z0-9]+)-\d+$/);
    return match ? match[1] : '';
  }

  // projects: { key, jql, ... }. Prefer a page whose issue types include this
  // ticket. An exact dashboard key wins among those matches.
  function dashboardProjectForIssue(issue, projects) {
    const projectKey = issueProjectKey(issue);
    if (!projectKey) return null;
    const typeName = String(
      (issue && issue.fields && issue.fields.issuetype && (issue.fields.issuetype.name || issue.fields.issuetype.value)) || ''
    ).trim().toLowerCase();
    const scored = [];
    (projects || []).forEach(function (proj) {
      if (!proj) return;
      const jql = proj.jql || '';
      const exact = String(proj.key || '').toUpperCase() === projectKey;
      const keys = projectKeysFromJql(jql);
      if (!exact && keys.indexOf(projectKey) < 0) return;
      const types = issueTypeNamesFromJql(jql).map(function (name) { return name.toLowerCase(); });
      const typeOk = !types.length || !typeName || types.indexOf(typeName) >= 0;
      scored.push({ proj: proj, exact: exact, typeOk: typeOk });
    });
    const typed = scored.filter(function (row) { return row.typeOk; });
    const pool = typed.length ? typed : scored;
    pool.sort(function (a, b) { return (b.exact - a.exact); });
    return pool.length ? pool[0].proj : null;
  }

  return {
    issueTypeNamesFromJql: issueTypeNamesFromJql,
    projectKeysFromJql: projectKeysFromJql,
    dashboardProjectForIssue: dashboardProjectForIssue,
  };
});
