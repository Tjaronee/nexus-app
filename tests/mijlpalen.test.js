import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mijlpalenOverview, mijlpaalView, epicView } from '../src/mijlpalen.js';
import { toIssue, withCid } from '../src/data/model.js';

/** @typedef {import('../src/data/model.js').Issue} Issue */
/** @typedef {import('../src/data/store.js').Milestone} Milestone */

let next = 1;

/** @param {Partial<Issue>} [over] @returns {Issue} */
function issue(over = {}) {
  const number = over.number ?? next++;
  return {
    ref: number,
    number,
    id: number * 10,
    cid: null,
    title: `Taak ${number}`,
    body: '',
    state: 'open',
    stateReason: null,
    labels: [],
    assignees: [],
    milestone: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockedByCount: 0,
    blockedBy: [],
    comments: 0,
    createdAt: `2026-09-01T10:00:${String(number % 60).padStart(2, '0')}Z`,
    updatedAt: '2026-09-01T10:00:00Z',
    closedAt: null,
    ...over,
  };
}

/** @param {Partial<Milestone> & { number: number, title: string }} over @returns {Milestone} */
const milestone = (over) => ({ state: 'open', description: '', dueOn: null, ...over });

const HUIS = milestone({ number: 1, title: 'Nieuw huis 2026' });
const IN_HUIS = { number: 1, title: 'Nieuw huis 2026' };

test('lists the open Mijlpalen with how many of their issues are closed', () => {
  const issues = [
    issue({ milestone: IN_HUIS }),
    issue({ milestone: IN_HUIS, state: 'closed' }),
    issue({ milestone: IN_HUIS, state: 'closed', labels: ['Epic'] }),
    issue({ title: 'los' }),
  ];
  const { open } = mijlpalenOverview(issues, [HUIS]);
  assert.deepEqual(
    open.map((m) => [m.title, m.progress]),
    [['Nieuw huis 2026', { closed: 2, total: 3 }]],
  );
});

test('closed Mijlpalen are kept apart; open ones go by due date, undated last', () => {
  const milestones = [
    milestone({ number: 1, title: 'Zonder datum' }),
    milestone({ number: 2, title: 'Later', dueOn: '2027-01-01T00:00:00Z' }),
    milestone({ number: 3, title: 'Klaar', state: 'closed' }),
    milestone({ number: 4, title: 'Eerst', dueOn: '2026-10-01T00:00:00Z' }),
  ];
  const { open, closed } = mijlpalenOverview([], milestones);
  assert.deepEqual(
    open.map((m) => m.title),
    ['Eerst', 'Later', 'Zonder datum'],
  );
  assert.deepEqual(
    closed.map((m) => [m.title, m.progress]),
    [['Klaar', { closed: 0, total: 0 }]],
  );
});

test('open Epics without a Mijlpaal form their own group, with progress over their sub-issues', () => {
  const verhuizen = issue({ title: 'Verhuizen', labels: ['Epic'] });
  const issues = [
    verhuizen,
    issue({ parent: verhuizen.number, state: 'closed' }),
    issue({ parent: verhuizen.number }),
    issue({ parent: verhuizen.number, milestone: IN_HUIS }),
    issue({ title: 'Oud', labels: ['Epic'], state: 'closed' }),
    issue({ title: 'In huis', labels: ['Epic'], milestone: IN_HUIS }),
    issue({ title: 'Losse Taak' }),
  ];
  const { zonder } = mijlpalenOverview(issues, [HUIS]);
  assert.deepEqual(
    zonder.map((e) => [e.issue.title, e.progress]),
    [['Verhuizen', { closed: 1, total: 3 }]],
  );
});

test('an Epic under another Epic shows inside it, not at the top of its group', () => {
  const groot = issue({ title: 'Groot', labels: ['Epic'] });
  const klein = issue({ title: 'Klein', parent: groot.number, subIssues: { total: 1, completed: 0 } });
  const taak = issue({ parent: klein.number });
  const { zonder } = mijlpalenOverview([groot, klein, taak], []);
  assert.deepEqual(
    zonder.map((e) => [e.issue.title, e.progress]),
    [['Groot', { closed: 0, total: 1 }]],
  );
});

test('a Mijlpaal shows its Epics with their progress, open ones first, and its open Taken outside an Epic', () => {
  const taxaties = issue({ title: 'Taxaties', labels: ['Epic'], milestone: IN_HUIS, state: 'closed' });
  const verhuizen = issue({ title: 'Verhuizen', labels: ['Epic'], milestone: IN_HUIS });
  const issues = [
    taxaties,
    verhuizen,
    issue({ parent: verhuizen.number, milestone: IN_HUIS, state: 'closed' }),
    issue({ title: 'Dozen', parent: verhuizen.number, milestone: IN_HUIS }),
    issue({ title: 'Meubels opmeten', milestone: IN_HUIS }),
    issue({ title: 'Oude Taak', milestone: IN_HUIS, state: 'closed' }),
    issue({ title: 'Andere mijlpaal', milestone: { number: 2, title: 'Anders' } }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.ok(view);
  assert.equal(view.title, 'Nieuw huis 2026');
  assert.deepEqual(view.progress, { closed: 3, total: 6 });
  assert.deepEqual(
    view.epics.map((e) => [e.issue.title, e.progress]),
    [
      ['Verhuizen', { closed: 1, total: 2 }],
      ['Taxaties', { closed: 0, total: 0 }],
    ],
  );
  assert.deepEqual(
    view.taken.map((r) => r.issue.title),
    ['Meubels opmeten'],
  );
});

test('the loose Taken of a Mijlpaal are sorted like the Taken list, Geblokkeerd ones last', () => {
  const blocker = issue({ title: 'ooit', labels: ['urgency: whenever'], milestone: IN_HUIS });
  const issues = [
    blocker,
    issue({ title: 'geblokkeerd', labels: ['urgency: now'], milestone: IN_HUIS, blockedBy: [blocker.ref] }),
    issue({ title: 'nu', labels: ['urgency: now'], milestone: IN_HUIS }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.deepEqual(
    view?.taken.map((r) => [r.issue.title, r.waitingFor.length]),
    [
      ['nu', 0],
      ['ooit', 0],
      ['geblokkeerd', 1],
    ],
  );
});

test('an unknown Mijlpaal has no screen', () => {
  assert.equal(mijlpaalView([], [HUIS], 99), null);
});

test('an Epic shows its open Taken, sorted like the Taken list, and its sub-Epics with their progress', () => {
  const epic = issue({ title: 'Verkoop eigen woning', labels: ['Epic'], milestone: IN_HUIS });
  const documenten = issue({ title: 'Documenten', parent: epic.number, subIssues: { total: 2, completed: 2 } });
  const issues = [
    epic,
    documenten,
    issue({ parent: documenten.number, state: 'closed' }),
    issue({ parent: documenten.number, state: 'closed' }),
    issue({ title: 'ooit', parent: epic.number, labels: ['urgency: whenever'] }),
    issue({ title: 'nu', parent: epic.number, labels: ['urgency: now'] }),
    issue({ title: 'klaar', parent: epic.number, state: 'closed' }),
    issue({ title: 'elders' }),
  ];
  const view = epicView(issues, epic.ref);
  assert.ok(view);
  assert.equal(view.title, 'Verkoop eigen woning');
  assert.deepEqual(view.progress, { closed: 1, total: 4 });
  assert.deepEqual(
    view.epics.map((e) => [e.issue.title, e.progress]),
    [['Documenten', { closed: 2, total: 2 }]],
  );
  assert.deepEqual(
    view.taken.map((r) => [r.issue.title, r.breadcrumb]),
    [
      ['nu', []],
      ['ooit', []],
    ],
  );
});

test("an Epic's screen has its description, without the hidden client ID", () => {
  const epic = toIssue({
    number: 7,
    title: 'Verhuizen',
    state: 'open',
    labels: [{ name: 'Epic' }],
    body: withCid('Zie [de makelaar](https://example.nl)', 'abc-1'),
  });
  assert.equal(epicView([epic], 7)?.description, 'Zie [de makelaar](https://example.nl)');
});

test('an Epic that is gone has no screen', () => {
  assert.equal(epicView([], 99), null);
});
