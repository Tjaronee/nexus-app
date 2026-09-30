import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockerOptions } from '../src/blocker-picker.js';

/** @typedef {import('../src/data/model.js').Issue} Issue */

/** @param {Partial<Issue>} over @returns {Issue} */
function issue(over) {
  const number = over.number ?? 1;
  return {
    ref: number, number, id: number, cid: null, title: `Taak ${number}`, body: '', state: 'open', stateReason: null,
    labels: [], assignees: [], milestone: null, parent: null, subIssues: { total: 0, completed: 0 },
    blockedByCount: 0, blockedBy: [], comments: 0, createdAt: '', updatedAt: '', closedAt: null,
    ...over,
  };
}

const ISSUES = [
  issue({ number: 1, title: 'Verhuizen', blockedBy: [2] }),
  issue({ number: 2, title: 'Sleutel ophalen' }),
  issue({ number: 3, title: 'Dozen kopen' }),
  issue({ number: 4, title: 'Dozijn eieren', labels: ['boodschappen'] }),
  issue({ number: 5, title: 'Dozen klaar', state: 'closed' }),
  issue({ number: 6, title: 'Dozen Epic', labels: ['Epic'] }),
  issue({ number: 7, title: 'Dozen inpakken', blockedBy: [1] }),
  issue({ number: 8, title: 'Café opzeggen' }),
  issue({ number: 23, title: 'Afval wegbrengen' }),
];
const SELF = ISSUES[0];
const forSelf = { self: SELF, chosen: SELF.blockedBy };

/** @param {string} query @param {Parameters<typeof blockerOptions>[1]} [taak] */
const titles = (query, taak = forSelf) => blockerOptions(ISSUES, taak, query).map((o) => o.title);

test('offers nothing until something is typed', () => {
  assert.deepEqual(titles(''), []);
  assert.deepEqual(titles('   '), []);
});

test('finds open Taken by part of the title, ignoring case and accents, sorted by title', () => {
  assert.deepEqual(titles('DOZ'), ['Dozen kopen']);
  assert.deepEqual(titles('cafe'), ['Café opzeggen']);
  assert.deepEqual(titles('e'), ['Afval wegbrengen', 'Café opzeggen', 'Dozen kopen']);
});

test('finds a Taak by its number, with or without #', () => {
  assert.deepEqual(titles('#23'), ['Afval wegbrengen']);
  assert.deepEqual(titles('23'), ['Afval wegbrengen']);
});

test('leaves out the Taak itself and Taken already linked to it either way', () => {
  assert.deepEqual(titles('verhuizen'), [], 'itself');
  assert.deepEqual(titles('sleutel'), [], 'already Geblokkeerd door');
  assert.deepEqual(titles('inpakken'), [], 'already blocked by it');
});

test('for a new Taak, leaves out only what is already chosen', () => {
  const taak = { self: null, chosen: [3] };
  assert.deepEqual(titles('dozen', taak), ['Dozen inpakken']);
  assert.deepEqual(titles('verhuizen', taak), ['Verhuizen']);
});

test('a Taak still being created can be found by title, and has no number', () => {
  const pending = issue({ ref: 'cid-1', number: null, cid: 'cid-1', title: 'Dozen tapen' });
  assert.deepEqual(blockerOptions([pending], { self: null, chosen: [] }, 'tapen'), [
    { ref: 'cid-1', title: 'Dozen tapen', number: null },
  ]);
});
