/**
 * Nest enhancements under their epic for the project issue table.
 * An epic that is not in the list still becomes a header from the parent fields.
 *
 * Browser: window.EpicGroups. Node: module.exports.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.EpicGroups = api;
})(function () {
  'use strict';

  function issueTypeName(issue) {
    const name = issue && issue.fields && issue.fields.issuetype && issue.fields.issuetype.name;
    return String(name || '').trim().toLowerCase();
  }

  function parentOf(issue) {
    const parent = issue && issue.fields && issue.fields.parent;
    if (!parent || !parent.key) return null;
    return parent;
  }

  function syntheticEpic(parent) {
    const fields = parent && parent.fields || {};
    const issuetype = fields.issuetype && fields.issuetype.name
      ? fields.issuetype
      : { name: 'Epic' };
    const nextFields = { summary: fields.summary || parent.key, issuetype };
    if (fields.status) nextFields.status = fields.status;
    if (fields.priority) nextFields.priority = fields.priority;
    return { key: parent.key, syntheticEpic: true, fields: nextFields };
  }

  /**
   * @param {Array} issues already in display order
   * @returns {Array<{kind:'issue',issue:object}|{kind:'epic',epicKey:string,synthetic:boolean,issue:object,children:object[]}>}
   */
  function groupIssuesUnderEpics(issues) {
    const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
    const epicByKey = new Map();
    list.forEach(issue => {
      if (issue.key && issueTypeName(issue) === 'epic') epicByKey.set(issue.key, issue);
    });

    const children = new Map();
    const childSet = new Set();
    list.forEach(issue => {
      if (issueTypeName(issue) !== 'enhancement') return;
      const parent = parentOf(issue);
      if (!parent) return;
      const parentType = String(parent.fields && parent.fields.issuetype && parent.fields.issuetype.name || '').trim().toLowerCase();
      const listed = epicByKey.has(parent.key);
      if (parentType && parentType !== 'epic') return;
      if (!parentType && !listed) return;
      if (!children.has(parent.key)) children.set(parent.key, []);
      children.get(parent.key).push(issue);
      childSet.add(issue);
    });

    const placed = new Set();
    const rows = [];

    function pushEpic(epicKey, parent) {
      if (placed.has(epicKey)) return;
      placed.add(epicKey);
      const listed = epicByKey.get(epicKey);
      rows.push({
        kind: 'epic',
        epicKey,
        synthetic: !listed,
        issue: listed || syntheticEpic(parent),
        children: children.get(epicKey) || [],
      });
    }

    list.forEach(issue => {
      if (childSet.has(issue)) {
        const parent = parentOf(issue);
        if (!epicByKey.has(parent.key)) pushEpic(parent.key, parent);
        return;
      }
      if (issue.key && issueTypeName(issue) === 'epic' && children.has(issue.key)) {
        pushEpic(issue.key, null);
        return;
      }
      rows.push({ kind: 'issue', issue });
    });

    return rows;
  }

  return { groupIssuesUnderEpics };
});
