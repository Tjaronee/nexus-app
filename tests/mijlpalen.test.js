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

test('Afgeronde Mijlpalen are kept apart; both lists go by creation, oldest first', () => {
  // A due date set before the app stopped setting them doesn't reorder anything.
  const milestones = [
    milestone({ number: 4, title: 'Nieuwste' }),
    milestone({ number: 2, title: 'Ouder', dueOn: '2027-01-01T00:00:00Z' }),
    milestone({ number: 5, title: 'Later klaar', state: 'closed' }),
    milestone({ number: 1, title: 'Oudste', dueOn: '2028-01-01T00:00:00Z' }),
    milestone({ number: 3, title: 'Klaar', state: 'closed' }),
  ];
  const { open, closed } = mijlpalenOverview([], milestones);
  assert.deepEqual(
    open.map((m) => m.title),
    ['Oudste', 'Ouder', 'Nieuwste'],
  );
  assert.deepEqual(
    closed.map((m) => [m.title, m.progress]),
    [
      ['Klaar', { closed: 0, total: 0 }],
      ['Later klaar', { closed: 0, total: 0 }],
    ],
  );
});

/** @param {ReturnType<typeof mijlpaalView>} view */
const rows = (view) => view?.groups.flatMap((g) => g.rows) ?? [];

test('a Mijlpaal shows its open Taken, without breadcrumbs', () => {
  const issues = [
    issue({ title: 'Meubels opmeten', milestone: IN_HUIS }),
    issue({ title: 'Oude Taak', milestone: IN_HUIS, state: 'closed' }),
    issue({ title: 'Melk', milestone: IN_HUIS, labels: ['boodschappen'] }),
    issue({ title: 'Andere mijlpaal', milestone: { number: 2, title: 'Anders' } }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.ok(view);
  assert.equal(view.title, 'Nieuw huis 2026');
  assert.equal(view.state, 'open');
  assert.deepEqual(view.progress, { closed: 1, total: 3 });
  assert.deepEqual(
    rows(view).map((r) => [r.issue.title, r.breadcrumb]),
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
    rows(view).map((r) => r.issue.title).sort(),
    ['Dozen', 'Verhuizen'],
  );
});

test('the Taken of a Mijlpaal are sorted like the Taken list, Geblokkeerd ones apart', () => {
  const blocker = issue({ title: 'ooit', labels: ['urgency: whenever'], milestone: IN_HUIS });
  const issues = [
    blocker,
    issue({ title: 'geblokkeerd', labels: ['urgency: now'], milestone: IN_HUIS, blockedBy: [blocker.ref] }),
    issue({ title: 'nu', labels: ['urgency: now'], milestone: IN_HUIS }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.deepEqual(
    rows(view).map((r) => r.issue.title),
    ['nu', 'ooit'],
  );
  assert.deepEqual(
    view?.blocked.map((r) => [r.issue.title, r.waitingFor.length]),
    [['geblokkeerd', 1]],
  );
});

test('the Taken of a Mijlpaal are grouped by Soort like the Taken list, Geen soort last', () => {
  const issues = [
    issue({ title: 'los', milestone: IN_HUIS }),
    issue({ title: 'verven', labels: ['soort: klussen'], milestone: IN_HUIS }),
    issue({ title: 'offerte', labels: ['soort: administratie'], milestone: IN_HUIS }),
    issue({ title: 'boren', labels: ['soort: klussen'], milestone: IN_HUIS }),
  ];
  const view = mijlpaalView(issues, [HUIS], 1);
  assert.deepEqual(
    view?.groups.map((g) => [g.soort, g.rows.map((r) => r.issue.title).sort()]),
    [
      ['administratie', ['offerte']],
      ['klussen', ['boren', 'verven']],
      [null, ['los']],
    ],
  );
});

test('Verwijderen is offered only when no issue at all has the Mijlpaal', () => {
  const canDelete = (/** @type {Issue[]} */ issues, m = HUIS) => mijlpaalView(issues, [m], 1)?.canDelete;
  assert.equal(canDelete([]), true);
  assert.equal(canDelete([issue({ milestone: { number: 2, title: 'Anders' } })]), true);
  assert.equal(canDelete([issue({ milestone: IN_HUIS })]), false);
  // Closed ones and Boodschappen count too: deleting would take it off them.
  assert.equal(canDelete([issue({ milestone: IN_HUIS, state: 'closed' })]), false);
  assert.equal(canDelete([issue({ milestone: IN_HUIS, labels: ['boodschappen'] })]), false);
  // GitHub also counts pull requests, which the app doesn't load.
  assert.equal(canDelete([], { ...HUIS, issueCount: 1 }), false);
});

test('an Afgeronde Mijlpaal can still be opened, and says so', () => {
  const view = mijlpaalView([], [milestone({ number: 1, title: 'Klaar', state: 'closed' })], 1);
  assert.equal(view?.state, 'closed');
});

test('an unknown Mijlpaal has no screen', () => {
  assert.equal(mijlpaalView([], [HUIS], 99), null);
});
