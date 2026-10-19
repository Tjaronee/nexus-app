import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, initialTab } from '../src/tabs.js';

test('tabs are Taken, Boodschappen, Indeling in that order', () => {
  assert.deepEqual(
    TABS.map((t) => t.label),
    ['Taken', 'Boodschappen', 'Indeling'],
  );
});

test('opens on the last used tab', () => {
  assert.equal(initialTab('boodschappen'), 'boodschappen');
  assert.equal(initialTab('mijlpalen'), 'mijlpalen');
});

test('falls back to Taken without a known last tab', () => {
  assert.equal(initialTab(null), 'taken');
  assert.equal(initialTab('instellingen'), 'taken');
});
