/**
 * Pasted ticket keys in search boxes.
 * Run: node scripts/test-ticket-search.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ticketKeysInQuery, ticketListQuery, keyListMatch, plainSearchText } = require('../lib/ticket-search');
const { workspaceSearchJql } = require('../lib/workspace-query');
const { buildReleasePlan } = require('../lib/release-plan');

assert.deepStrictEqual(ticketKeysInQuery('nfs-12'), ['NFS-12']);
assert.strictEqual(ticketListQuery('nfs-12'), null);
assert.strictEqual(keyListMatch('nfs-12', 'NFS-120'), null);
assert.strictEqual(keyListMatch('NFS-12,', 'NFS-12'), true);
assert.strictEqual(keyListMatch('NFS-12,', 'NFS-120'), false);

assert.deepStrictEqual(ticketListQuery('NFS-1, gl-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('NFS-1 gl-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('NFS-1;GL-2|P2P-3'), ['NFS-1', 'GL-2', 'P2P-3']);
assert.deepStrictEqual(ticketListQuery('NFS-1/GL-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('NFS-1\nGL-2\tBUGS-9'), ['NFS-1', 'GL-2', 'BUGS-9']);
assert.deepStrictEqual(ticketListQuery('- NFS-1\n- GL-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('NFS-1 and GL-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('(NFS-1), [GL-2]'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketKeysInQuery('https://nakisa.atlassian.net/browse/NFS-1 https://nakisa.atlassian.net/browse/GL-2'), ['NFS-1', 'GL-2']);
assert.deepStrictEqual(ticketListQuery('NFS-1, NFS-1, GL-2'), ['NFS-1', 'GL-2']);

assert.strictEqual(ticketListQuery('closing watch'), null);
assert.strictEqual(ticketListQuery('NFS-1, login'), null);
assert.strictEqual(ticketListQuery('project = NFS AND status = Open'), null);
assert.strictEqual(keyListMatch('NFS-1, GL-2', 'gl-2'), true);
assert.strictEqual(keyListMatch('NFS-1, GL-2', 'NFS-10'), false);
assert.strictEqual(plainSearchText('  NFS-12, '), 'nfs-12');

assert.strictEqual(workspaceSearchJql('nfs-12'), 'key = NFS-12');
assert.strictEqual(workspaceSearchJql('NFS-1, gl-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('NFS-1; gl-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('NFS-1 | GL-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('NFS-1\nGL-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('https://example.atlassian.net/browse/NFS-1, https://example.atlassian.net/browse/GL-2'), 'key in (NFS-1, GL-2)');
assert.strictEqual(workspaceSearchJql('project = NFS AND status = Open'), 'project = NFS AND status = Open');
assert.strictEqual(workspaceSearchJql('closing watch'), 'text ~ "closing watch" ORDER BY updated DESC');

const plan = buildReleasePlan({
  today: '2026-01-05',
  query: 'NFS-1, GL-2',
  tickets: [
    { key: 'NFS-1', summary: 'One', developer: 'Ada', status: 'Open', phase: 'Developing', estimate: 1 },
    { key: 'GL-2', summary: 'Two', developer: 'Ada', status: 'Open', phase: 'Developing', estimate: 1 },
    { key: 'NFS-9', summary: 'NFS-1 mentioned', developer: 'Ada', status: 'Open', phase: 'Developing', estimate: 1 },
  ],
});
const planKeys = [];
plan.people.forEach(row => row.tickets.forEach(ticket => planKeys.push(ticket.key)));
assert.deepStrictEqual(planKeys.sort(), ['GL-2', 'NFS-1']);

const dashboard = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
const proxy = fs.readFileSync(path.join(__dirname, '../proxy.js'), 'utf8');
assert.ok(dashboard.includes('/lib/ticket-search.js'));
assert.ok(dashboard.includes('TicketSearch.keyListMatch'));
assert.ok(dashboard.includes('Search or paste keys'));
assert.ok(proxy.includes("app.get('/lib/ticket-search.js'"));

console.log('ticket-search ok');
