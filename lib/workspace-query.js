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
  const MAX_QUERY = 8000;

  function ticketSearchApi() {
    if (typeof window !== 'undefined' && window.TicketSearch) return window.TicketSearch;
    if (typeof require === 'function') return require('./ticket-search');
    return null;
  }

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
    const ticketSearch = ticketSearchApi();
    const listed = ticketSearch && ticketSearch.ticketKeysInQuery(text);
    if (listed && listed.length) {
      if (listed.length === 1) return 'key = ' + listed[0];
      return 'key in (' + listed.join(', ') + ')';
    }
    if (looksLikeJql(text)) return text;
    const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return 'text ~ "' + safe + '" ORDER BY updated DESC';
  }

  return { workspaceSearchJql, KEY_RE };
});
