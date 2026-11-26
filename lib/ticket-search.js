/**
 * Paste a list of ticket keys into a search box.
 * Browser: window.TicketSearch. Node: module.exports.
 *
 * Two or more keys, with only separators between them, match those keys.
 * One key, or any other text, stays a normal text search.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TicketSearch = api;
})(function () {
  'use strict';

  const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
  const SPLIT_RE = /[\s,;|+/\\&]+/;
  const EDGE_LEAD = /^[\s,;|+/\\&#.:'"()[\]{}<>•·–—-]+/;
  const EDGE_TAIL = /[\s,;|+/\\&#.:'"()[\]{}<>•·–—-]+$/;

  function stripEdges(value) {
    return String(value || '').replace(EDGE_LEAD, '').replace(EDGE_TAIL, '');
  }

  function uniqueKeys(parts) {
    const keys = [];
    const seen = Object.create(null);
    parts.forEach(part => {
      const key = String(part || '').toUpperCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      keys.push(key);
    });
    return keys;
  }

  function extractedKeys(text) {
    const keys = [];
    const seen = Object.create(null);
    const re = /[A-Z][A-Z0-9_]*-\d+/gi;
    let match;
    while ((match = re.exec(text))) {
      const key = match[0].toUpperCase();
      if (seen[key]) continue;
      seen[key] = true;
      keys.push(key);
    }
    return keys;
  }

  function leftoverText(text) {
    return String(text || '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/[A-Z][A-Z0-9_]*-\d+/gi, ' ')
      .replace(/\b(and|or)\b/gi, ' ')
      .replace(/[^A-Za-z0-9]+/g, '');
  }

  // Every token is a ticket key, including a single key. Null when the query
  // also contains words, so a normal search is left unchanged.
  function ticketKeysInQuery(query) {
    const text = String(query == null ? '' : query).trim();
    if (!text) return null;
    const parts = text.split(SPLIT_RE).map(stripEdges).filter(Boolean);
    if (parts.length && parts.every(part => KEY_RE.test(part.toUpperCase()))) {
      return uniqueKeys(parts);
    }
    const keys = extractedKeys(text);
    if (!keys.length || leftoverText(text)) return null;
    return keys;
  }

  // Two or more keys. A single key stays a text search so "NFS-12" still
  // finds NFS-120.
  function ticketListQuery(query) {
    const keys = ticketKeysInQuery(query);
    if (!keys || keys.length < 2) return null;
    return keys;
  }

  // true / false when the query is a key list. null when it is ordinary text.
  function keyListMatch(query, key) {
    const keys = ticketKeysInQuery(query);
    if (!keys) return null;
    const text = String(query == null ? '' : query).trim();
    // A bare key stays a text search so "NFS-12" still finds NFS-120.
    if (keys.length < 2 && KEY_RE.test(text.toUpperCase())) return null;
    return keys.indexOf(String(key || '').toUpperCase()) !== -1;
  }

  function plainSearchText(query) {
    return stripEdges(String(query == null ? '' : query).trim()).toLowerCase();
  }

  return {
    KEY_RE,
    ticketKeysInQuery,
    ticketListQuery,
    keyListMatch,
    plainSearchText,
  };
});
