import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailOf, blockerOptions, assigneeChange } from '../src/detail.js';

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

test('finds the Taak by number or by the client ID it was created with', () => {
  const pending = issue({ number: 12, cid: 'cid-1', title: 'Nieuw' });
  assert.equal(detailOf([pending], 12)?.issue.title, 'Nieuw');
  assert.equal(detailOf([pending], 'cid-1')?.issue.title, 'Nieuw');
  assert.equal(detailOf([pending], 99), null);
});

test('reads Prio and Urgentie, treating an unlabelled Taak as middel / binnenkort', () => {
  const d = detailOf([issue({ number: 1, labels: ['prio: high'] })], 1);
  assert.equal(d?.prio, 'hoog');
  assert.equal(d?.urgentie, 'binnenkort');
});

test('lists what blocks the Taak, open or closed, and what it blocks', () => {
  const issues = [
    issue({ number: 1, title: 'Verhuizen', blockedBy: [2, 3, 7] }),
    issue({ number: 2, title: 'Sleutel ophalen' }),
    issue({ number: 3, title: 'Dozen kopen', state: 'closed' }),
    issue({ number: 4, title: 'Kasten opbouwen', blockedBy: [1] }),
    issue({ number: 5, title: 'Oud', state: 'closed', blockedBy: [1] }),
  ];
  const d = detailOf(issues, 1);
  assert.deepEqual(d?.blockedBy, [
    { ref: 2, title: 'Sleutel ophalen', open: true },
    { ref: 3, title: 'Dozen kopen', open: false },
    { ref: 7, title: '#7', open: true },
  ]);
  assert.deepEqual(d?.blocking, [{ ref: 4, title: 'Kasten opbouwen' }]);
});

test('can be blocked by any other open Taak it is not blocked by yet, found by title or number', () => {
  const issues = [
    issue({ number: 1, title: 'Verhuizen', blockedBy: [2] }),
    issue({ number: 2, title: 'Sleutel ophalen' }),
    issue({ number: 3, title: 'Dozen kopen' }),
    issue({ number: 4, title: 'Dozijn eieren', labels: ['boodschappen'] }),
    issue({ number: 5, title: 'Klaar', state: 'closed' }),
    issue({ number: 6, title: 'Tuin', labels: ['Epic'] }),
    issue({ number: 23, title: 'Afval wegbrengen' }),
  ];
  const self = issues[0];
  assert.deepEqual(
    blockerOptions(issues, self, '').map((o) => o.title),
    ['Afval wegbrengen', 'Dozen kopen'],
  );
  assert.deepEqual(blockerOptions(issues, self, 'doz').map((o) => o.ref), [3]);
  assert.deepEqual(blockerOptions(issues, self, '#23').map((o) => o.ref), [23]);
  assert.deepEqual(blockerOptions(issues, self, '23').map((o) => o.ref), [23]);
});

test('turns the ticked people into who to add and who to remove, ignoring case', () => {
  assert.deepEqual(assigneeChange(['Tjaronee'], ['tjaronee', 'partner']), { add: ['partner'], remove: [] });
  assert.deepEqual(assigneeChange(['Tjaronee', 'partner'], []), { add: [], remove: ['Tjaronee', 'partner'] });
  assert.deepEqual(assigneeChange([], []), { add: [], remove: [] });
});
