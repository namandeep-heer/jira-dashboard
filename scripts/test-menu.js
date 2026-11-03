/**
 * Menu group assignment.
 * Run: node scripts/test-menu.js
 */

'use strict';

const assert = require('assert');
const { normalizeMenuGroups, assignProjects, defaultMenuGroups } = require('../lib/menu');

const projects = [
  { key: 'NFS', id: 'p0', name: 'Lease Accounting', category: 'Core Modules' },
  { key: 'FCO', id: 'p1', name: 'FOS', category: 'Infrastructure' },
  { key: 'BUGS', id: 'p6', name: 'Open Bugs', category: 'Quality' },
  { key: 'PEGL', id: 'p7', name: 'Pre-Go Live', category: 'Quality' },
  { key: 'NEW', id: 'cp_new', name: 'Extra', category: '' },
];

const defaults = normalizeMenuGroups(undefined);
assert.strictEqual(defaults[0].id, 'delivery');
assert.strictEqual(defaults[0].catchAll, true);
assert.strictEqual(defaults[1].label, 'Quality');
assert.deepStrictEqual(defaults[1].categories, ['Quality']);
assert.ok(defaults[0].pages.includes('velocity'));
assert.ok(defaults[1].pages.includes('quality-insights'));
assert.ok(!defaults[0].pages.includes('quality-insights'));

const buckets = assignProjects(defaults, projects);
assert.deepStrictEqual(buckets[0].map(p => p.key), ['NFS', 'FCO', 'NEW']);
assert.deepStrictEqual(buckets[1].map(p => p.key), ['BUGS', 'PEGL']);

const custom = normalizeMenuGroups([
  { id: 'delivery', label: 'Products', catchAll: true, categories: [], pages: ['analytics', 'velocity', 'nope'] },
  { id: 'quality', label: 'Quality', categories: ['Quality'], pages: ['quality-insights'] },
  { label: 'Platform', categories: ['Infrastructure'], pages: [] },
]);
assert.strictEqual(custom[0].label, 'Products');
assert.strictEqual(custom[2].id, 'platform');
assert.deepStrictEqual(custom[0].pages, ['analytics', 'velocity']);
assert.deepStrictEqual(custom[1].pages, ['quality-insights']);
assert.deepStrictEqual(custom[2].pages, []);

const customBuckets = assignProjects(custom, projects);
assert.deepStrictEqual(customBuckets[0].map(p => p.key), ['NFS', 'NEW']);
assert.deepStrictEqual(customBuckets[1].map(p => p.key), ['BUGS', 'PEGL']);
assert.deepStrictEqual(customBuckets[2].map(p => p.key), ['FCO']);

const firstWins = assignProjects([
  { id: 'a', label: 'A', categories: ['Quality'], catchAll: false, pages: ['velocity'] },
  { id: 'b', label: 'B', categories: ['Quality'], catchAll: true, pages: [] },
], projects);
assert.deepStrictEqual(firstWins[0].map(p => p.key), ['BUGS', 'PEGL']);
assert.ok(firstWins[1].every(p => p.category !== 'Quality'));

assert.strictEqual(normalizeMenuGroups([])[0].id, 'delivery');
assert.strictEqual(defaultMenuGroups()[1].id, 'quality');

console.log('menu: ok');
