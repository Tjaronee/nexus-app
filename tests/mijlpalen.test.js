import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mijlpalenOverview, mijlpaalView } from '../src/mijlpalen.js';
import { toIssue } from '../src/data/model.js';

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
    issue({ milestone: IN_HUIS, state: 'closed', labels: ['prio: high'] }),
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

test('a Mijlpaal shows its open Taken as one list, without breadcrumbs', () => {
  const issues = [
    issue({ title: 'Meubels opmeten', milestone: IN_HUIS }),
    issue({ title: 'Oude Taak', milestone: IN_HUIS, state: 'closed' }),
    issue({ title: 'Melk', milestone: IN_HUIS, labels: ['boodschappen'] }),
    issue({ title: 'Andere mijlpaal', milestone: { number: 2, title: 'Anders' } }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.ok(view);
  assert.equal(view.title, 'Nieuw huis 2026');
  assert.deepEqual(view.progress, { closed: 1, total: 3 });
  assert.deepEqual(
    view.taken.map((r) => [r.issue.title, r.breadcrumb]),
    [['Meubels opmeten', []]],
  );
});

test('a former Epic and its sub-issues are ordinary Taken in the Mijlpaal', () => {
  // As GitHub sends them: the sub-issue links are still there, and ignored.
  const raw = (/** @type {object} */ over) =>
    toIssue({ state: 'open', labels: [], milestone: IN_HUIS, created_at: '2026-09-01T10:00:00Z', ...over });
  const issues = [
    raw({ number: 7, title: 'Verhuizen', labels: [{ name: 'Epic' }], sub_issues_summary: { total: 1, completed: 0 } }),
    raw({ number: 8, title: 'Dozen', parent_issue_url: 'https://api.github.com/repos/Tjaronee/Nexus/issues/7' }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.deepEqual(
    view?.taken.map((r) => r.issue.title).sort(),
    ['Dozen', 'Verhuizen'],
  );
});

test('the Taken of a Mijlpaal are sorted like the Taken list, Geblokkeerd ones last', () => {
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
