import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOORT_PREFIX, normaliseSoort, soortOf, knownSoorten, groupBySoort, tapSoort, soortChange } from '../src/soort.js';

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
