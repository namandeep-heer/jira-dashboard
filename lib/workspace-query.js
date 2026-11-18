/**
 * Turn a workspace search box into JQL.
 * Browser: window.WorkspaceQuery. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.WorkspaceQuery = api;
})(function () {
  'use strict';

  const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
  const MAX_QUERY = 2000;

  function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function looksLikeJql(text) {
    if (/[=<>~]/.test(text)) return true;
    if (/\b(AND|OR|ORDER\s+BY)\b/i.test(text)) return true;
    if (/\b(project|issuetype|status|assignee|reporter|priority|fixVersion|summary|text|type|parent|labels|sprint)\b/i.test(text)
      && /\b(in|is|was)\b/i.test(text)) return true;
    return false;
  }

  function workspaceSearchJql(query) {
    const text = String(query == null ? '' : query).replace(/\r\n/g, '\n').trim();
    if (!text) throw httpError(400, 'Enter a ticket key or a query.');
    if (text.length > MAX_QUERY) throw httpError(400, 'Query is too long.');
    const parts = text.split(/[\s,]+/).filter(Boolean);
    if (parts.length && parts.every(part => KEY_RE.test(part.toUpperCase()))) {
      const keys = parts.map(part => part.toUpperCase());
      if (keys.length === 1) return 'key = ' + keys[0];
      return 'key in (' + keys.join(', ') + ')';
    }
    if (looksLikeJql(text)) return text;
    const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return 'text ~ "' + safe + '" ORDER BY updated DESC';
  }

  return { workspaceSearchJql, KEY_RE };
});
