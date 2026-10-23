/**
 * Editors for Jira writeback. The server writes with the signed-in user's token.
 */
(function () {
  const EDITABLE = {
    status: { kind: 'transition', label: 'Status', note: 'This moves the ticket in Jira.' },
    cf_devest: { kind: 'number', label: 'Dev Estimate (Days)' },
    cf_devact: { kind: 'number', label: 'Dev Actual (Days)' },
    cf_scope: { kind: 'option', label: 'Scope Commitment', note: 'This changes the scope used in the release score.' },
    cf_scopesc: { kind: 'option', label: 'Scope Commitment At SC', note: 'This is the scope recorded at scope commitment. Changing it changes the release score.' },
    cf_clarity: { kind: 'option', label: 'A + Clarity' },
    cf_custcom: { kind: 'option', label: 'Customer Commitment' },
    assignee: { kind: 'user', label: 'Assignee' },
    cf_devpart: { kind: 'user', label: 'Development Partner' },
    cf_dev: { kind: 'user', label: 'Development' },
    cf_product: { kind: 'user', label: 'Product' },
    fixVersions: { kind: 'versions', label: 'Fix Versions', note: 'This changes which release the ticket belongs to.' },
    parent: { kind: 'parent', label: 'Parent' },
    priority: { kind: 'priority', label: 'Priority' },
    summary: { kind: 'summary', label: 'Summary' },
  };

  let root = null;
  let lastFocus = null;
  let session = 0;
  let busy = false;
  let onKey = null;

  function canEdit(id) {
    return !!EDITABLE[id];
  }

  function fieldDef(logicalId) {
    return (typeof ALL_FIELDS !== 'undefined' && ALL_FIELDS.find(function (field) { return field.id === logicalId; })) || null;
  }

  function jiraFieldId(logicalId) {
    const field = fieldDef(logicalId);
    if (!field) return logicalId;
    return typeof jiraId === 'function' ? jiraId(field) : field.jira;
  }

  function findIssue(key) {
    let found = null;
    function walk(projects) {
      if (found || !projects || typeof projects !== 'object') return;
      Object.keys(projects).forEach(function (name) {
        const bucket = projects[name];
        const issues = bucket && bucket.issues;
        if (!Array.isArray(issues)) return;
        issues.forEach(function (issue) {
          if (!found && issue && issue.key === key) found = issue;
        });
      });
    }
    if (typeof S !== 'undefined') {
      walk(S.cache);
      if (S.releaseCache) Object.keys(S.releaseCache).forEach(function (name) { walk(S.releaseCache[name]); });
    }
    return found;
  }

  function rawField(issue, logicalId) {
    const field = fieldDef(logicalId);
    if (!field || !issue || !issue.fields) return null;
    return issue.fields[jiraFieldId(logicalId)];
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'jira-write-root';
    root.hidden = true;
    root.innerHTML = ''
      + '<div class="jw-backdrop" data-jw-close="1"></div>'
      + '<div class="jw-panel" role="dialog" aria-modal="true" aria-labelledby="jw-title" tabindex="-1">'
      + '  <header class="jw-head"><div><p class="jw-key" id="jw-key"></p><h2 id="jw-title"></h2></div>'
      + '    <button type="button" class="btn btn-sm" data-jw-close="1">Close</button></header>'
      + '  <p class="jw-note" id="jw-note" hidden></p>'
      + '  <div class="jw-body" id="jw-body"></div>'
      + '  <p class="jw-error" id="jw-error" role="alert" hidden></p>'
      + '  <footer class="jw-foot"><span class="jw-foot-note">Saves with your Jira account.</span>'
      + '    <button type="button" class="btn btn-sm" data-jw-close="1">Cancel</button>'
      + '    <button type="button" class="btn btn-sm primary" id="jw-save">Save to Jira</button></footer>'
      + '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('[data-jw-close]')) close();
    });
    document.getElementById('jw-save').addEventListener('click', saveCurrent);
    return root;
  }

  function close() {
    if (busy) return;
    session += 1;
    if (root) root.hidden = true;
    if (onKey) {
      document.removeEventListener('keydown', onKey);
      onKey = null;
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function showError(message) {
    const el = document.getElementById('jw-error');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function setBusy(next) {
    busy = next;
    const save = document.getElementById('jw-save');
    if (save) {
      save.disabled = next;
      save.textContent = next ? 'Saving…' : 'Save to Jira';
    }
    root.querySelectorAll('input, select, textarea, button').forEach(function (el) {
      if (el.id === 'jw-save') return;
      if (next) el.setAttribute('disabled', 'disabled');
      else el.removeAttribute('disabled');
    });
  }

  function bindKeys() {
    if (onKey) document.removeEventListener('keydown', onKey);
    onKey = function (event) {
      if (root.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        saveCurrent();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll('button, input, select, textarea')).filter(function (el) {
        return !el.disabled && !el.hidden;
      });
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
  }

  function focusFirst() {
    const item = root.querySelector('#jw-body input, #jw-body select, #jw-body textarea, #jw-body button');
    if (item) item.focus();
  }

  let current = null;

  function open(event, key, logicalId) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const spec = EDITABLE[logicalId];
    if (!spec) return;
    const issue = findIssue(key);
    lastFocus = event && event.currentTarget ? event.currentTarget : document.activeElement;
    ensureRoot();
    current = { key: key, logicalId: logicalId, spec: spec, issue: issue, token: ++session };
    busy = false;
    const saveBtn = document.getElementById('jw-save');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to Jira';
    document.getElementById('jw-key').textContent = key;
    document.getElementById('jw-title').textContent = spec.label;
    const note = document.getElementById('jw-note');
    note.hidden = !spec.note;
    note.textContent = spec.note || '';
    showError('');
    root.hidden = false;
    bindKeys();
    const panel = root.querySelector('.jw-panel');
    if (panel) panel.focus();
    const body = document.getElementById('jw-body');
    if (!issue) {
      body.innerHTML = '<p class="jw-empty-copy">This ticket is not in the synced cache.</p>';
      document.getElementById('jw-save').disabled = true;
      return;
    }
    if (!issue.fields || !issue.fields.updated) {
      body.innerHTML = '<p class="jw-empty-copy">Refresh this release before editing. The cached ticket has no updated time.</p>';
      document.getElementById('jw-save').disabled = true;
      return;
    }
    body.innerHTML = '<p class="jw-empty-copy">Loading choices from Jira…</p>';
    loadForm(current).catch(function (err) {
      if (current.token !== session) return;
      body.innerHTML = '';
      showError(err.message || 'Could not load this field from Jira.');
      document.getElementById('jw-save').disabled = true;
    });
  }

  async function loadForm(state) {
    const token = state.token;
    if (state.spec.kind === 'transition') {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(state.key) + '/transitions');
      const json = await res.json().catch(function () { return {}; });
      if (token !== session) return;
      if (!res.ok) throw new Error(json.error || 'Could not load transitions.');
      state.transitions = json.transitions || [];
      renderTransition(state);
      return;
    }
    if (state.spec.kind === 'versions') {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(state.key) + '/versions');
      const json = await res.json().catch(function () { return {}; });
      if (token !== session) return;
      if (!res.ok) throw new Error(json.error || 'Could not load fix versions.');
      state.versions = json.versions || [];
      renderVersions(state);
      return;
    }
    if (state.spec.kind === 'summary') {
      await renderSummary(state);
      return;
    }
    if (state.logicalId === 'assignee') {
      state.fieldId = 'assignee';
      if (token !== session) return;
      renderUser(state);
      return;
    }
    if (state.spec.kind === 'parent') {
      if (token !== session) return;
      renderParent(state);
      return;
    }
    const fieldId = jiraFieldId(state.logicalId);
    state.fieldId = fieldId;
    const res = await authFetch('/api/jira/issue/' + encodeURIComponent(state.key) + '/meta?field=' + encodeURIComponent(fieldId));
    const json = await res.json().catch(function () { return {}; });
    if (token !== session) return;
    if (!res.ok) throw new Error(json.error || 'You cannot edit this field on this ticket.');
    state.meta = json;
    renderMeta(state);
  }

  function sameText(a, b) {
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
  }

  async function renderSummary(state) {
    const cached = (state.issue.fields && state.issue.fields.summary) || '';
    state.summaryBaseline = cached;
    let value = cached;
    let note = '';
    try {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(state.key));
      const json = await res.json().catch(function () { return {}; });
      if (state.token !== session) return;
      if (res.ok && typeof json.summary === 'string') {
        value = json.summary;
        state.summaryBaseline = json.summary;
        if (json.updated) state.issue.fields.updated = json.updated;
        if (!sameText(value, cached)) note = 'Loaded the current summary from Jira.';
      } else if (!res.ok) {
        note = json.error || 'Showing the synced summary. Jira could not be reloaded.';
      }
    } catch (err) {
      if (state.token !== session) return;
      note = 'Showing the synced summary. Jira could not be reloaded.';
    }
    if (state.token !== session) return;
    document.getElementById('jw-body').innerHTML = '<label class="jw-label" for="jw-summary">Summary</label>'
      + '<textarea id="jw-summary" class="jw-input jw-summary" maxlength="255" rows="4">' + esc(value) + '</textarea>'
      + (note ? '<p class="jw-hint">' + esc(note) + '</p>' : '');
    focusFirst();
  }

  function renderParent(state) {
    const parent = state.issue.fields && state.issue.fields.parent;
    const key = parent && parent.key || '';
    document.getElementById('jw-body').innerHTML = '<label class="jw-label" for="jw-parent">Parent key</label>'
      + '<input id="jw-parent" class="jw-input" type="text" autocomplete="off" spellcheck="false" placeholder="Leave blank to clear" value="' + esc(key) + '">'
      + '<p class="jw-hint" id="jw-parent-hint">' + esc(parent && parent.fields && parent.fields.summary || '') + '</p>';
    const input = document.getElementById('jw-parent');
    let timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      const token = state.token;
      timer = setTimeout(function () { previewParent(input.value, token); }, 250);
    });
    focusFirst();
  }

  async function previewParent(value, token) {
    const hint = document.getElementById('jw-parent-hint');
    const key = String(value || '').trim().toUpperCase();
    if (!hint || token !== session) return;
    if (!key) { hint.textContent = 'The parent will be cleared.'; return; }
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) { hint.textContent = 'Enter a ticket key.'; return; }
    hint.textContent = 'Looking up ' + key + '…';
    const res = await authFetch('/api/jira/issue/' + encodeURIComponent(key));
    const json = await res.json().catch(function () { return {}; });
    if (token !== session) return;
    if (!res.ok) { hint.textContent = json.error || 'No ticket with that key.'; return; }
    hint.textContent = json.key + (json.type ? ' · ' + json.type : '') + (json.summary ? ' — ' + json.summary : '');
  }

  function optionLabel(value) {
    return value.value || value.name || value.id || '';
  }

  function renderMeta(state) {
    const meta = state.meta || {};
    const allowed = meta.allowedValues || [];
    if (state.spec.kind === 'priority' || allowed.length) {
      renderChoice(state, allowed, state.spec.kind === 'priority');
      return;
    }
    if (meta.schemaType === 'number' || state.spec.kind === 'number') {
      renderNumber(state);
      return;
    }
    if (meta.schemaType === 'user' || state.spec.kind === 'user') {
      renderUser(state);
      return;
    }
    if (meta.schemaType === 'string') {
      const raw = rawField(state.issue, state.logicalId);
      const text = raw == null ? '' : String(raw.value || raw.name || raw);
      document.getElementById('jw-body').innerHTML = '<label class="jw-label" for="jw-text">' + esc(state.spec.label) + '</label>'
        + '<input id="jw-text" class="jw-input" type="text" maxlength="2000" value="' + esc(text) + '">';
      state.control = 'text';
      focusFirst();
      return;
    }
    document.getElementById('jw-body').innerHTML = '<p class="jw-empty-copy">This field type cannot be edited here.</p>';
    document.getElementById('jw-save').disabled = true;
  }

  function renderChoice(state, allowed, isPriority) {
    const raw = isPriority
      ? (state.issue.fields && state.issue.fields.priority)
      : rawField(state.issue, state.logicalId);
    const currentId = raw && raw.id != null ? String(raw.id) : '';
    const currentLabel = raw && (raw.name || raw.value) || (typeof raw === 'string' ? raw : '');
    const options = allowed.map(function (value) {
      const id = value.id || '';
      const label = optionLabel(value);
      const selected = (currentId && id === currentId) || (!currentId && currentLabel && label === currentLabel);
      return '<option value="' + esc(id || label) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    const clear = isPriority ? '' : '<option value="">Clear</option>';
    document.getElementById('jw-body').innerHTML = '<label class="jw-label" for="jw-choice">' + esc(state.spec.label) + '</label>'
      + '<select id="jw-choice" class="jw-input">' + clear + options + '</select>';
    state.control = isPriority ? 'priority' : 'option';
    state.choiceByValue = {};
    allowed.forEach(function (value) {
      state.choiceByValue[value.id || optionLabel(value)] = value;
    });
    focusFirst();
  }

  function renderNumber(state) {
    const raw = rawField(state.issue, state.logicalId);
    const value = raw == null || raw === '' ? '' : String(raw);
    document.getElementById('jw-body').innerHTML = '<label class="jw-label" for="jw-number">' + esc(state.spec.label) + '</label>'
      + '<input id="jw-number" class="jw-input" type="number" min="0" max="100000" step="0.5" inputmode="decimal" value="' + esc(value) + '">'
      + '<p class="jw-hint">Leave blank to clear the field.</p>';
    state.control = 'number';
    focusFirst();
  }

  function renderUser(state) {
    const raw = rawField(state.issue, state.logicalId);
    const person = Array.isArray(raw) ? raw[0] : raw;
    state.accountId = person && person.accountId || '';
    const name = person && (person.displayName || person.name) || 'No one assigned';
    document.getElementById('jw-body').innerHTML = '<p class="jw-current" id="jw-user-current">' + esc(name) + '</p>'
      + '<label class="jw-label" for="jw-user-q">Search people</label>'
      + '<input id="jw-user-q" class="jw-input" type="search" autocomplete="off">'
      + '<div class="jw-list" id="jw-user-list" role="listbox"></div>'
      + '<button type="button" class="btn btn-sm" id="jw-unassign">Clear assignment</button>';
    state.control = 'user';
    document.getElementById('jw-unassign').addEventListener('click', function () {
      state.accountId = '';
      document.getElementById('jw-user-current').textContent = 'Assignment will be cleared';
    });
    const input = document.getElementById('jw-user-q');
    let timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      const token = state.token;
      timer = setTimeout(function () { searchUsers(state, input.value, token); }, 220);
    });
    if (state.logicalId === 'assignee') searchUsers(state, '', state.token);
    focusFirst();
  }

  async function searchUsers(state, query, token) {
    const list = document.getElementById('jw-user-list');
    if (!list || token !== session) return;
    const fieldId = state.logicalId === 'assignee' ? 'assignee' : state.fieldId;
    const params = new URLSearchParams({ query: query || '', issueKey: state.key, fieldId: fieldId });
    const res = await authFetch('/api/jira/users?' + params.toString());
    const json = await res.json().catch(function () { return {}; });
    if (token !== session) return;
    if (!res.ok) {
      list.innerHTML = '<p class="jw-hint">' + esc(json.error || 'Could not search people.') + '</p>';
      return;
    }
    const users = json.users || [];
    if (!users.length) {
      list.innerHTML = '<p class="jw-hint">No matching people.</p>';
      return;
    }
    list.innerHTML = users.map(function (user) {
      return '<button type="button" class="jw-pick" data-account="' + esc(user.accountId) + '">' + esc(user.displayName) + '</button>';
    }).join('');
    list.querySelectorAll('.jw-pick').forEach(function (button) {
      button.addEventListener('click', function () {
        state.accountId = button.getAttribute('data-account');
        document.getElementById('jw-user-current').textContent = button.textContent;
      });
    });
  }

  function renderVersions(state) {
    const selected = new Set(((state.issue.fields && state.issue.fields.fixVersions) || []).map(function (version) {
      return version && version.id != null ? String(version.id) : '';
    }));
    const versions = state.versions.slice().sort(function (a, b) {
      if (!!a.released !== !!b.released) return a.released ? 1 : -1;
      return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    }).filter(function (version) {
      return !version.archived || selected.has(version.id);
    });
    if (!versions.length) {
      document.getElementById('jw-body').innerHTML = '<p class="jw-empty-copy">This project has no fix versions.</p>';
      document.getElementById('jw-save').disabled = true;
      return;
    }
    document.getElementById('jw-body').innerHTML = '<div class="jw-list">' + versions.map(function (version) {
      const id = 'jw-ver-' + version.id;
      return '<label class="jw-check" for="' + id + '"><input id="' + id + '" type="checkbox" value="' + esc(version.id) + '"'
        + (selected.has(version.id) ? ' checked' : '') + '>'
        + '<span>' + esc(version.name) + (version.released ? ' <span class="jw-muted">released</span>' : '') + '</span></label>';
    }).join('') + '</div><p class="jw-hint">Uncheck every version to clear Fix Version.</p>';
    state.control = 'versions';
    focusFirst();
  }

  function renderTransition(state) {
    const transitions = state.transitions || [];
    if (!transitions.length) {
      document.getElementById('jw-body').innerHTML = '<p class="jw-empty-copy">No transitions are available for your Jira account.</p>';
      document.getElementById('jw-save').disabled = true;
      return;
    }
    const current = (state.issue.fields && state.issue.fields.status && state.issue.fields.status.name) || '';
    document.getElementById('jw-body').innerHTML = '<p class="jw-current">Now ' + esc(current) + '</p><div class="jw-list" id="jw-transitions">'
      + transitions.map(function (transition) {
        const label = transition.to && transition.to.name ? transition.to.name : transition.name;
        return '<label class="jw-check"><input type="radio" name="jw-transition" value="' + esc(transition.id) + '">'
          + '<span>' + esc(label) + '</span></label>';
      }).join('') + '</div><div id="jw-transition-extra"></div>';
    state.control = 'transition';
    root.querySelectorAll('input[name="jw-transition"]').forEach(function (input) {
      input.addEventListener('change', function () { renderTransitionExtra(state, input.value); });
    });
    focusFirst();
  }

  function renderTransitionExtra(state, id) {
    const extra = document.getElementById('jw-transition-extra');
    const transition = (state.transitions || []).find(function (item) { return item.id === id; });
    state.transition = transition;
    if (!extra || !transition) return;
    if (transition.unsupported && transition.unsupported.length) {
      extra.innerHTML = '<p class="jw-hint">This transition asks for ' + esc(transition.unsupported.join(', '))
        + ', which this dashboard cannot fill. Open the ticket in Jira.</p>';
      return;
    }
    extra.innerHTML = (transition.fields || []).map(function (field) {
      if (field.kind === 'comment') {
        return '<label class="jw-label" for="jw-comment">' + esc(field.name) + '</label><textarea id="jw-comment" class="jw-input" rows="3" maxlength="2000"></textarea>';
      }
      const options = (field.allowedValues || []).map(function (value) {
        return '<option value="' + esc(value.id) + '">' + esc(value.label) + '</option>';
      }).join('');
      return '<label class="jw-label" for="jw-resolution">' + esc(field.name) + '</label><select id="jw-resolution" class="jw-input"><option value="">Choose</option>' + options + '</select>';
    }).join('');
  }

  function collect(state) {
    if (state.control === 'summary' || state.spec.kind === 'summary') {
      return { type: 'summary', summary: document.getElementById('jw-summary').value };
    }
    if (state.control === 'number') {
      return { type: 'number', fieldId: state.fieldId, value: document.getElementById('jw-number').value };
    }
    if (state.control === 'text') {
      return { type: 'text', fieldId: state.fieldId, text: document.getElementById('jw-text').value };
    }
    if (state.control === 'priority') {
      const selected = document.getElementById('jw-choice').value;
      const choice = state.choiceByValue[selected];
      if (!choice || !choice.id) throw new Error('Choose a priority.');
      return { type: 'priority', priorityId: choice.id };
    }
    if (state.control === 'option') {
      const selected = document.getElementById('jw-choice').value;
      if (!selected) return { type: 'option', fieldId: state.fieldId, optionId: null };
      const choice = state.choiceByValue[selected] || {};
      if (choice.id) return { type: 'option', fieldId: state.fieldId, optionId: choice.id };
      return { type: 'option', fieldId: state.fieldId, optionValue: choice.value || selected };
    }
    if (state.control === 'user') {
      return {
        type: 'user',
        fieldId: state.logicalId === 'assignee' ? 'assignee' : state.fieldId,
        accountId: state.accountId || null,
      };
    }
    if (state.control === 'versions') {
      const versions = Array.from(root.querySelectorAll('.jw-check input:checked')).map(function (input) {
        return { id: input.value };
      });
      return { type: 'versions', versions: versions };
    }
    if (state.spec.kind === 'parent') {
      const parentKey = document.getElementById('jw-parent').value.trim();
      if (parentKey && parentKey.toUpperCase() === state.key) throw new Error('A ticket cannot be its own parent.');
      return { type: 'parent', parentKey: parentKey };
    }
    if (state.control === 'transition') {
      const selected = root.querySelector('input[name="jw-transition"]:checked');
      if (!selected) throw new Error('Choose a status.');
      const transition = (state.transitions || []).find(function (item) { return item.id === selected.value; });
      if (transition && transition.unsupported && transition.unsupported.length) {
        throw new Error('Open the ticket in Jira to use this transition.');
      }
      const change = { type: 'transition', transitionId: selected.value };
      const resolution = document.getElementById('jw-resolution');
      if (resolution) {
        if (!resolution.value) throw new Error('Choose a resolution.');
        change.resolutionId = resolution.value;
      }
      const comment = document.getElementById('jw-comment');
      if (comment) {
        if (!comment.value.trim()) throw new Error('Enter the transition comment.');
        change.comment = comment.value;
      }
      return change;
    }
    throw new Error('This field cannot be saved.');
  }

  async function recoverSummaryConflict(json) {
    const input = document.getElementById('jw-summary');
    if (!input || !current) return '';
    let liveSummary = null;
    let liveUpdated = json && typeof json.updated === 'string' ? json.updated : '';
    try {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(current.key));
      const brief = await res.json().catch(function () { return {}; });
      if (!current || current.token !== session) return '';
      if (res.ok && brief) {
        if (typeof brief.summary === 'string') liveSummary = brief.summary;
        if (brief.updated) liveUpdated = brief.updated;
      }
    } catch (err) {
      liveSummary = null;
    }
    if (!current || current.token !== session) return '';
    if (!liveUpdated || liveSummary == null) return '';
    if (sameText(liveSummary, current.summaryBaseline)) {
      current.issue.fields.updated = liveUpdated;
      return 'retry';
    }
    current.issue.fields.updated = liveUpdated;
    current.summaryBaseline = liveSummary;
    const shown = liveSummary.length > 180 ? liveSummary.slice(0, 177) + '…' : liveSummary;
    showError('Jira has a newer summary: ' + shown + ' Your text is still in the box. Save again to replace it.');
    return 'shown';
  }

  async function saveCurrent(attempt) {
    if (!current || current.token !== session) return;
    if (busy && attempt !== 1) return;
    let change;
    try {
      change = collect(current);
    } catch (err) {
      showError(err.message || 'Check this field and try again.');
      return;
    }
    setBusy(true);
    showError('');
    const token = current.token;
    try {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(current.key), {
        method: 'POST',
        body: JSON.stringify({ updated: current.issue.fields.updated, change: change }),
      });
      const json = await res.json().catch(function () { return {}; });
      if (token !== session) return;
      if (res.status === 409 && attempt !== 1 && current.spec.kind === 'summary') {
        const action = await recoverSummaryConflict(json);
        if (!current || current.token !== session) return;
        if (action === 'retry') return saveCurrent(1);
        setBusy(false);
        if (action !== 'shown') showError(json.error || 'This ticket changed in Jira. Refresh and try again.');
        return;
      }
      if (!res.ok || !json.issue) throw new Error(json.error || 'Could not save to Jira.');
      applyLocal(json.issue);
      busy = false;
      close();
      refreshOpen();
    } catch (err) {
      setBusy(false);
      showError(err.message || 'Could not save to Jira.');
    }
  }

  function applyLocal(issue) {
    if (!issue || !issue.key || typeof S === 'undefined') return;
    function visit(row) {
      if (!row || row.key !== issue.key) return;
      row.id = issue.id || row.id;
      row.fields = issue.fields;
      if (issue.changelog) row.changelog = issue.changelog;
    }
    function walk(projects) {
      if (!projects || typeof projects !== 'object') return;
      Object.keys(projects).forEach(function (name) {
        const issues = projects[name] && projects[name].issues;
        if (!Array.isArray(issues)) return;
        issues.forEach(visit);
      });
    }
    walk(S.cache);
    if (S.releaseCache) Object.keys(S.releaseCache).forEach(function (name) { walk(S.releaseCache[name]); });
    if (S._projData) {
      Object.keys(S._projData).forEach(function (name) {
        const data = S._projData[name];
        if (data && Array.isArray(data.issues)) data.issues.forEach(visit);
      });
    }
  }

  function refreshOpen() {
    try {
      const proj = typeof getAllProjects === 'function' && getAllProjects().find(function (item) { return item.id === S.page; });
      if (proj && S.cache && S.cache[proj.key] && typeof filterIssuesToActiveRelease === 'function') {
        const filtered = filterIssuesToActiveRelease(S.cache[proj.key].issues || [], proj);
        if (!S._projData) S._projData = {};
        const prev = S._projData[proj.key] || {};
        S._projData[proj.key] = Object.assign({}, prev, { issues: filtered.issues });
        if (typeof refreshProjectListing === 'function') refreshProjectListing(proj.key);
        return;
      }
      if (S.page === 'data-gaps' && typeof renderDataGaps === 'function') renderDataGaps();
      else if (S.page === 'velocity' && typeof renderVelocity === 'function') renderVelocity();
      else if (S.page === 'analytics' && typeof renderAnalytics === 'function') renderAnalytics();
      else if (S.page === 'quality-insights' && typeof renderQualityInsights === 'function') renderQualityInsights();
      else if ((S.page === 'quality-phase' || S.page === 'phase-timeline') && typeof renderPhaseTimeline === 'function') renderPhaseTimeline();
      else if ((S.page === 'quality-progress' || S.page === 'log') && typeof renderDailyProgress === 'function') renderDailyProgress();
      else if (S.page === 'team' && typeof renderTeam === 'function') renderTeam();
      else if (S.page === 'release-report' && typeof renderReleaseReportPage === 'function') renderReleaseReportPage();
    } catch (err) {
      console.error('[jira-write]', err);
    }
  }

  function wrap(key, logicalId, label, innerHtml) {
    if (!canEdit(logicalId)) return innerHtml;
    const name = 'Edit ' + (label || logicalId) + ' for ' + (key || '');
    const shown = innerHtml && String(innerHtml).trim() ? innerHtml : '<span class="jw-empty">—</span>';
    return '<span class="jw-cell"><span class="jw-value">' + shown + '</span><button type="button" class="jw-edit" aria-label="'
      + esc(name) + '" onclick=\'JiraWrite.open(event,' + JSON.stringify(key) + ',' + JSON.stringify(logicalId) + ')\'>'
      + '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button></span>';
  }

  function gapButton(key, logicalId, innerHtml) {
    const spec = EDITABLE[logicalId];
    const name = 'Edit ' + (spec ? spec.label : logicalId) + ' for ' + key;
    return '<button type="button" class="jw-gap" aria-label="' + esc(name) + '" onclick=\'JiraWrite.open(event,'
      + JSON.stringify(key) + ',' + JSON.stringify(logicalId) + ')\'>' + innerHtml + '</button>';
  }

  function parseDays(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { empty: true, value: null };
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: 'Enter a number from 0 to 100000.' };
    return { empty: false, value: Math.round(n * 100) / 100 };
  }

  function daysUnchanged(original, parsed) {
    if (parsed.empty) return !original;
    if (!original) return false;
    return Number(original) === parsed.value;
  }

  function daysField(key, logicalId, value) {
    const spec = EDITABLE[logicalId];
    const name = (spec ? spec.label : 'Days') + ' for ' + key;
    const shown = value == null || value === '' ? '' : String(value);
    const missing = shown === '' ? ' is-missing' : '';
    return '<span class="jw-days-wrap" onclick="event.stopPropagation()">'
      + '<input class="jw-days' + missing + '" type="number" min="0" max="100000" step="0.5" inputmode="decimal"'
      + ' aria-label="' + esc(name) + '" placeholder="Add" value="' + esc(shown) + '"'
      + ' data-key="' + esc(key) + '" data-field="' + esc(logicalId) + '" data-original="' + esc(shown) + '"'
      + ' onkeydown="JiraWrite.onDaysKey(event)" onblur="JiraWrite.onDaysBlur(event)">'
      + '</span>';
  }

  function onDaysKey(event) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.value = event.currentTarget.getAttribute('data-original') || '';
      event.currentTarget.dataset.skip = '1';
      event.currentTarget.classList.remove('is-error');
      event.currentTarget.removeAttribute('title');
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDays(event.currentTarget, 'enter');
    }
  }

  function onDaysBlur(event) {
    const input = event.currentTarget;
    if (input.dataset.skip === '1') {
      delete input.dataset.skip;
      return;
    }
    if (input.dataset.saving === '1') return;
    commitDays(input, 'blur');
  }

  function nextDaysTarget(input) {
    const all = Array.from(document.querySelectorAll('input.jw-days'));
    const next = all[all.indexOf(input) + 1];
    if (!next) return null;
    return { key: next.getAttribute('data-key'), field: next.getAttribute('data-field') };
  }

  function focusDaysTarget(target) {
    if (!target || !target.key) return;
    const el = document.querySelector('input.jw-days[data-key="' + CSS.escape(target.key) + '"][data-field="' + CSS.escape(target.field) + '"]');
    if (el) el.focus();
  }

  async function commitDays(input, intent) {
    if (!input || input.dataset.saving === '1') return;
    const parsed = parseDays(input.value);
    const original = input.getAttribute('data-original') || '';
    if (parsed.error) {
      input.classList.add('is-error');
      input.title = parsed.error;
      return;
    }
    if (daysUnchanged(original, parsed)) {
      input.classList.remove('is-error');
      input.removeAttribute('title');
      if (intent === 'enter') focusDaysTarget(nextDaysTarget(input));
      return;
    }
    const key = input.getAttribute('data-key');
    const logicalId = input.getAttribute('data-field');
    const issue = findIssue(key);
    if (!issue || !issue.fields || !issue.fields.updated) {
      input.classList.add('is-error');
      input.title = 'Refresh this release before editing. The cached ticket has no updated time.';
      return;
    }
    const next = intent === 'enter' ? nextDaysTarget(input) : null;
    input.dataset.saving = '1';
    input.disabled = true;
    input.classList.remove('is-error');
    input.title = 'Saving to Jira…';
    try {
      const res = await authFetch('/api/jira/issue/' + encodeURIComponent(key), {
        method: 'POST',
        body: JSON.stringify({
          updated: issue.fields.updated,
          change: { type: 'number', fieldId: jiraFieldId(logicalId), value: parsed.empty ? null : parsed.value },
        }),
      });
      const json = await res.json().catch(function () { return {}; });
      if (!res.ok || !json.issue) throw new Error(json.error || 'Could not save to Jira.');
      applyLocal(json.issue);
      input.dataset.saving = '0';
      const focused = document.activeElement;
      const focusedTarget = focused && focused.classList && focused.classList.contains('jw-days') && focused !== input
        ? { key: focused.getAttribute('data-key'), field: focused.getAttribute('data-field') }
        : null;
      refreshOpen();
      if (intent === 'enter') focusDaysTarget(next);
      else if (focusedTarget) focusDaysTarget(focusedTarget);
    } catch (err) {
      input.dataset.saving = '0';
      input.disabled = false;
      input.classList.add('is-error');
      input.title = err.message || 'Could not save to Jira.';
      input.focus();
    }
  }

  window.JiraWrite = {
    canEdit: canEdit,
    open: open,
    wrap: wrap,
    gapButton: gapButton,
    daysField: daysField,
    onDaysKey: onDaysKey,
    onDaysBlur: onDaysBlur,
  };
})();
