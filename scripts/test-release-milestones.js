/**
 * Unit tests for per-release milestone sets.
 * Run: node scripts/test-release-milestones.js
 */

'use strict';

const assert = require('assert');
const {
  normalizeMilestoneDate,
  ensureReleaseMilestoneSet,
  releaseMilestoneDefs,
  newReleaseFromMaster,
  applyMilestoneSet,
  removeMilestoneFromRelease,
  addMilestoneToRelease,
  rememberMilestoneDef,
  renameMilestoneId,
  catalogFromRelease,
  moveId,
} = require('../lib/release-milestones');

const catalog = [
  { id: 'DA', label: 'Discovery Alignment', fullName: 'DISCOVERY ALIGNMENT', color: '#185FA5' },
  { id: 'KO', label: 'Release Kickoff', fullName: 'RELEASE KICKOFF', color: '#185FA5' },
  { id: 'GA', label: 'General Availability', fullName: 'GENERAL AVAILABILITY', color: '#7cb842' },
];

const legacy = {
  name: 'N2026.R2',
  milestones: { DA: '2026-03-03', EXTRA: '2026-12-01' },
};
ensureReleaseMilestoneSet(legacy, catalog);
assert.deepStrictEqual(legacy.milestoneIds, ['DA', 'KO', 'GA', 'EXTRA']);
assert.strictEqual(legacy.milestones.EXTRA, '2026-12-01');
assert.strictEqual(legacy.milestones.DA, '2026-03-03');

const explicit = {
  name: 'Custom',
  milestoneIds: ['GA'],
  milestones: { GA: '2027-01-01', DA: '2027-02-01' },
  localMilestones: { GA: { id: 'GA', label: 'Stale', fullName: 'Stale', color: '#000000' } },
};
ensureReleaseMilestoneSet(explicit, catalog);
assert.deepStrictEqual(explicit.milestoneIds, ['GA']);
assert.deepStrictEqual(explicit.milestones, { GA: '2027-01-01' });
assert.deepStrictEqual(explicit.localMilestones, {});
const defs = releaseMilestoneDefs(explicit, catalog);
assert.strictEqual(defs.length, 1);
assert.strictEqual(defs[0].label, 'General Availability');

const empty = { name: 'Empty', milestoneIds: [], milestones: { DA: '2026-01-01' } };
ensureReleaseMilestoneSet(empty, catalog);
assert.deepStrictEqual(empty.milestoneIds, []);
assert.deepStrictEqual(empty.milestones, {});

const created = newReleaseFromMaster('N2028.R1', catalog);
assert.deepStrictEqual(created.milestoneIds, ['DA', 'KO', 'GA']);
assert.deepStrictEqual(created.milestones, {});

const target = {
  name: 'N2027.R1',
  milestoneIds: ['DA', 'KO', 'GA'],
  milestones: { DA: '2026-09-15', KO: '2026-09-29', GA: '2027-04-15' },
  localMilestones: {},
};
const source = {
  name: 'N2026.R2',
  milestoneIds: ['KO', 'GA', 'BETA'],
  milestones: { KO: '2026-04-07', GA: '2026-09-30', BETA: '2026-08-01' },
  localMilestones: {
    BETA: { id: 'BETA', label: 'Beta', fullName: 'BETA DROP', color: '#e0a040' },
  },
};
applyMilestoneSet(target, source.milestoneIds, source.localMilestones, catalog);
assert.deepStrictEqual(target.milestoneIds, ['KO', 'GA', 'BETA']);
assert.strictEqual(target.milestones.KO, '2026-09-29');
assert.strictEqual(target.milestones.GA, '2027-04-15');
assert.strictEqual(target.milestones.DA, undefined);
assert.strictEqual(target.milestones.BETA, undefined);
assert.strictEqual(target.localMilestones.BETA.label, 'Beta');

applyMilestoneSet(target, source.milestoneIds, source.localMilestones, catalog, {
  copyDates: true,
  sourceDates: source.milestones,
});
assert.strictEqual(target.milestones.KO, '2026-04-07');
assert.strictEqual(target.milestones.BETA, '2026-08-01');
assert.strictEqual(target.milestones.DA, undefined);

removeMilestoneFromRelease(target, 'BETA', catalog);
assert.deepStrictEqual(target.milestoneIds, ['KO', 'GA']);
assert.strictEqual(target.localMilestones.BETA, undefined);
assert.strictEqual(target.milestones.BETA, undefined);

addMilestoneToRelease(target, 'DA', catalog);
assert.deepStrictEqual(target.milestoneIds, ['KO', 'GA', 'DA']);
addMilestoneToRelease(target, 'RC', catalog, {
  id: 'RC', label: 'Release Candidate', fullName: 'RELEASE CANDIDATE', color: '#533AB7',
});
assert.strictEqual(target.localMilestones.RC.label, 'Release Candidate');
assert.strictEqual(releaseMilestoneDefs(target, catalog).find(item => item.id === 'RC').fullName, 'RELEASE CANDIDATE');

const releases = [target, { name: 'Other', milestoneIds: ['DA'], milestones: {}, localMilestones: {} }];
rememberMilestoneDef(releases, catalog[0]);
releases[0].milestoneIds = moveId(releases[0].milestoneIds, 2, -1);
assert.strictEqual(releases[0].milestoneIds[1], 'DA');

const ko = catalog[1];
target.milestoneIds = ['KO', 'GA'];
rememberMilestoneDef([target], ko);
const master = catalog.filter(item => item.id !== 'KO');
ensureReleaseMilestoneSet(target, master);
assert.strictEqual(target.localMilestones.KO.label, 'Release Kickoff');
assert.strictEqual(releaseMilestoneDefs(target, master).find(item => item.id === 'KO').label, 'Release Kickoff');

renameMilestoneId([target], 'KO', 'KO2');
assert.ok(target.milestoneIds.includes('KO2'));
assert.ok(!target.milestoneIds.includes('KO'));
assert.strictEqual(target.localMilestones.KO2.label, 'Release Kickoff');
assert.strictEqual(target.localMilestones.KO, undefined);

const customRelease = {
  name: 'N2027.R1',
  milestoneIds: ['GA', 'BETA'],
  milestones: {},
  localMilestones: {
    BETA: { id: 'BETA', label: 'Beta', fullName: 'BETA DROP', color: '#e0a040' },
  },
};
const otherRelease = {
  name: 'N2026.R2',
  milestoneIds: ['DA', 'KO'],
  milestones: {},
  localMilestones: {},
};
const nextCatalog = catalogFromRelease(customRelease, catalog, [customRelease, otherRelease]);
assert.deepStrictEqual(nextCatalog.map(item => item.id), ['GA', 'BETA']);
assert.strictEqual(nextCatalog.find(item => item.id === 'BETA').label, 'Beta');
assert.strictEqual(otherRelease.localMilestones.DA.label, 'Discovery Alignment');
assert.strictEqual(otherRelease.localMilestones.KO.label, 'Release Kickoff');
ensureReleaseMilestoneSet(customRelease, nextCatalog);
assert.strictEqual(customRelease.localMilestones.BETA, undefined);
assert.strictEqual(releaseMilestoneDefs(customRelease, nextCatalog).find(item => item.id === 'BETA').fullName, 'BETA DROP');

assert.strictEqual(normalizeMilestoneDate('2027-02-05'), '2027-02-05');
assert.strictEqual(normalizeMilestoneDate('202702-02-05'), '2027-02-05');
const repaired = { name: 'R', milestoneIds: ['DF'], milestones: { DF: '202702-02-05' }, localMilestones: {} };
ensureReleaseMilestoneSet(repaired, [{ id: 'DF', label: 'Dev Freeze', fullName: 'DEV FREEZE', color: '#e0a040' }]);
assert.strictEqual(repaired.milestones.DF, '2027-02-05');

console.log('release milestone tests passed');
