import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailOf, assigneeChange, editChoices } from '../src/detail.js';

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
    issue({ number: 1, title: 'Verhuizen', blockedBy: [2, 3, 7, 'cid-9'] }),
    issue({ number: 2, title: 'Sleutel ophalen' }),
    issue({ number: 3, title: 'Dozen kopen', state: 'closed' }),
    issue({ number: 4, title: 'Kasten opbouwen', blockedBy: [1] }),
    issue({ number: 5, title: 'Oud', state: 'closed', blockedBy: [1] }),
  ];
  const d = detailOf(issues, 1);
  assert.deepEqual(d?.blockedBy, [
    { ref: 2, title: 'Sleutel ophalen', open: true, known: true },
    { ref: 3, title: 'Dozen kopen', open: false, known: true },
    { ref: 7, title: '#7', open: true, known: false },
    { ref: 'cid-9', title: 'Onbekende Taak', open: true, known: false },
  ]);
  assert.deepEqual(d?.blocking, [{ ref: 4, title: 'Kasten opbouwen', open: true, known: true }]);
});

test('turns the ticked people into who to add and who to remove, ignoring case', () => {
  assert.deepEqual(assigneeChange(['Tjaronee'], ['tjaronee', 'partner']), { add: ['partner'], remove: [] });
  assert.deepEqual(assigneeChange(['Tjaronee', 'partner'], []), { add: [], remove: ['Tjaronee', 'partner'] });
  assert.deepEqual(assigneeChange([], []), { add: [], remove: [] });
});

test('the pickers show what the Taak has now, even a closed Epic or Mijlpaal', () => {
  const issues = [
    issue({ number: 1, title: 'Verhuizen', labels: ['Epic'] }),
    issue({ number: 2, title: 'Oude klus', labels: ['Epic'], state: 'closed' }),
    issue({ number: 3, parent: 2, milestone: { number: 9, title: 'Bruiloft' }, assignees: [{ login: 'Tjaronee', avatarUrl: '' }] }),
  ];
  const milestones = [{ number: 1, title: 'Nieuw huis 2026', state: /** @type {const} */ ('open'), description: '', dueOn: null }];

  const c = editChoices({ issues, milestones }, issues[2], 'tjaronee');

  assert.deepEqual(c.epics.map((e) => e.title), ['Verhuizen', 'Oude klus']);
  assert.equal(c.epic, 1);
  assert.deepEqual(c.mijlpalen.map((m) => m.title), ['Nieuw huis 2026', 'Bruiloft']);
  assert.equal(c.mijlpaal, 1);
  assert.deepEqual(c.people, ['tjaronee']);
  assert.deepEqual(c.toegewezen, ['tjaronee']);
});

test('the pickers show nothing chosen for a Taak without Epic, Mijlpaal or people', () => {
  const taak = issue({ number: 3 });
  const c = editChoices({ issues: [taak], milestones: [] }, taak, 'tjaronee');
  assert.equal(c.epic, -1);
  assert.equal(c.mijlpaal, -1);
  assert.deepEqual(c.toegewezen, []);
});

test('someone Toegewezen who is not offered yet is added to the people', () => {
  const taak = issue({ number: 3, assignees: [{ login: 'gast', avatarUrl: '' }] });
  const c = editChoices({ issues: [], milestones: [] }, taak, 'tjaronee');
  assert.deepEqual(c.people, ['tjaronee', 'gast']);
  assert.deepEqual(c.toegewezen, ['gast']);
});
