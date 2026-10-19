import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOORT_PREFIX,
  normaliseSoort,
  soortOf,
  knownSoorten,
  groupBySoort,
  tapSoort,
  soortChange,
  soortenOverview,
  newSoort,
  deleteEffect,
} from '../src/soort.js';

/** Only what Soorten are read from. @param {string[]} labels */
const withLabels = (labels) =>
  /** @type {import('../src/data/model.js').Issue} */ (/** @type {unknown} */ ({ labels, state: 'open' }));

test('a Soort is normalised like a Plek: one space, lowercase, fits a label', () => {
  assert.equal(SOORT_PREFIX, 'soort: ');
  assert.equal(normaliseSoort('  Huis   houden '), 'huis houden');
  assert.equal(normaliseSoort('x'.repeat(60)).length, 50 - SOORT_PREFIX.length);
});

test('a Taak without a soort: label has no Soort', () => {
  assert.equal(soortOf(withLabels([])), null);
  assert.equal(soortOf(withLabels(['prio: high', 'waar: AH'])), null);
});

test('a Taak with two soort: labels has the alphabetically first one, normalised', () => {
  assert.equal(soortOf(withLabels(['soort: sociaal'])), 'sociaal');
  assert.equal(soortOf(withLabels(['soort: Sociaal', 'soort: klusjes'])), 'klusjes');
});

test('the known Soorten are the soort: labels in Nexus, alphabetically and normalised', () => {
  const labels = ['prio: high', 'soort: sociaal', 'soort: Huishouden', 'soort: huishouden', 'waar: AH'];
  assert.deepEqual(knownSoorten(labels), ['huishouden', 'sociaal']);
});

test('the known Soorten include those open Taken have that the label list lacks', () => {
  assert.deepEqual(knownSoorten(['soort: sociaal'], [withLabels(['soort: klusjes'])]), ['klusjes', 'sociaal']);
});

test('groups keep the row order, alphabetically by Soort, Geen soort last, no empty groups', () => {
  const rows = [
    { name: 'a', soort: null },
    { name: 'b', soort: 'sociaal' },
    { name: 'c', soort: 'huishouden' },
    { name: 'd', soort: 'sociaal' },
    { name: 'e', soort: null },
  ];
  assert.deepEqual(
    groupBySoort(rows).map((g) => [g.soort, g.rows.map((r) => r.name)]),
    [
      ['huishouden', ['c']],
      ['sociaal', ['b', 'd']],
      [null, ['a', 'e']],
    ],
  );
  assert.deepEqual(groupBySoort([]), []);
});

test('tapping a Soort chip chooses it; tapping the chosen one clears it', () => {
  assert.equal(tapSoort(null, 'klusjes'), 'klusjes');
  assert.equal(tapSoort('sociaal', 'klusjes'), 'klusjes');
  assert.equal(tapSoort('klusjes', 'klusjes'), null);
});

test('moving to another Soort removes the old soort: label and adds the new one', () => {
  assert.deepEqual(soortChange(['prio: high', 'soort: sociaal'], 'klusjes'), { add: ['soort: klusjes'], remove: ['soort: sociaal'] });
});

test('clearing the Soort removes every soort: label and adds none', () => {
  assert.deepEqual(soortChange(['soort: sociaal', 'waar: AH'], null), { add: [], remove: ['soort: sociaal'] });
  assert.deepEqual(soortChange(['prio: high'], null), { add: [], remove: [] });
});

test('of two hand-made soort: labels only the chosen one stays, as it was written', () => {
  assert.deepEqual(soortChange(['soort: Sociaal', 'soort: klusjes'], 'sociaal'), { add: [], remove: ['soort: klusjes'] });
  assert.deepEqual(soortChange(['soort: sociaal', 'soort: Sociaal '], 'sociaal'), { add: [], remove: ['soort: Sociaal '] });
  assert.deepEqual(soortChange(['soort: sociaal', 'soort: klusjes'], 'tuin'), {
    add: ['soort: tuin'],
    remove: ['soort: sociaal', 'soort: klusjes'],
  });
});
/** A Taak or Boodschap with these labels. @param {string[]} labels @param {'open' | 'closed'} [state] */
const withState = (labels, state = 'open') =>
  /** @type {import('../src/data/model.js').Issue} */ (/** @type {unknown} */ ({ labels, state }));

test('the Soorten section lists every soort: label alphabetically, with its open Taken', () => {
  const labels = ['prio: high', 'soort: sociaal', 'soort: huishouden', 'soort: klusjes', 'waar: AH'];
  const issues = [
    withState(['soort: sociaal']),
    withState(['soort: sociaal']),
    withState(['soort: sociaal'], 'closed'),
    withState(['soort: klusjes', 'boodschappen']),
    withState(['soort: huishouden'], 'closed'),
  ];
  assert.deepEqual(soortenOverview(labels, issues), [
    { soort: 'huishouden', labels: ['soort: huishouden'], open: 0 },
    { soort: 'klusjes', labels: ['soort: klusjes'], open: 0 },
    { soort: 'sociaal', labels: ['soort: sociaal'], open: 2 },
  ]);
});

test('a Soort written by hand in several ways is one row, holding each of its labels', () => {
  const labels = ['soort: Klusjes', 'soort:  klusjes'];
  const issues = [withState(['soort: Klusjes']), withState(['soort:  klusjes']), withState(['soort: tuin'], 'closed')];
  assert.deepEqual(soortenOverview(labels, issues), [
    { soort: 'klusjes', labels: ['soort: Klusjes', 'soort:  klusjes'], open: 2 },
    { soort: 'tuin', labels: ['soort: tuin'], open: 0 },
  ]);
});

test('a new Soort is saved as its normalised label', () => {
  assert.deepEqual(newSoort('  Sociaal   Leven ', []), { label: 'soort: sociaal leven' });
});

test('a new Soort needs a name', () => {
  assert.deepEqual(newSoort('   ', []), { problem: 'empty' });
});

test('a name that normalises to an existing Soort creates nothing', () => {
  const labels = ['soort: huishouden', 'soort: Klusjes'];
  assert.deepEqual(newSoort('Huishouden', labels), { problem: 'exists', soort: 'huishouden' });
  assert.deepEqual(newSoort(' klusjes ', labels), { problem: 'exists', soort: 'klusjes' });
  assert.deepEqual(newSoort('tuin', labels, [withState(['soort: tuin'], 'closed')]), { problem: 'exists', soort: 'tuin' });
});

test('deleting a Soort says what happens to its open Taken', () => {
  assert.equal(deleteEffect(7), '7 open Taken worden Geen soort.');
  assert.equal(deleteEffect(1), '1 open Taak wordt Geen soort.');
  assert.equal(deleteEffect(0), 'Er zijn geen open Taken met deze Soort.');
});
