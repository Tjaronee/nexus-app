import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, MORE_TABS, initialTab } from '../src/tabs.js';

test('the tab bar has Taken and Boodschappen, in that order', () => {
  assert.deepEqual(
    TABS.map((t) => t.label),
    ['Taken', 'Boodschappen'],
  );
});

test('Indeling is behind ⋮, not in the tab bar', () => {
  assert.deepEqual(
    MORE_TABS.map((t) => t.label),
    ['Indeling'],
  );
  assert.equal(TABS.some((t) => t.id === 'mijlpalen'), false);
});

test('opens on the last used tab, also one behind ⋮', () => {
  assert.equal(initialTab('boodschappen'), 'boodschappen');
  assert.equal(initialTab('mijlpalen'), 'mijlpalen');
});

test('falls back to Taken without a known last tab', () => {
  assert.equal(initialTab(null), 'taken');
  assert.equal(initialTab('instellingen'), 'taken');
});
