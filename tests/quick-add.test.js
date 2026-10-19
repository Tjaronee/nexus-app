import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, choices, DEFAULTS } from '../src/quick-add.js';
import { takenList, ALL } from '../src/taken.js';
import { createStore } from '../src/data/store.js';
import { createGitHub } from '../src/github.js';
import { createFakeGitHub } from './fake-github.js';
import { memoryStorage } from './memory-storage.js';

function setup() {
  const server = createFakeGitHub();
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  let n = 0;
  const store = createStore({ github, storage: memoryStorage(), newId: () => `cid-${++n}` });
  return { server, store };
}

/** @param {ReturnType<typeof createStore>} store @param {string} title */
const byTitle = (store, title) => store.getState().issues.find((i) => i.title === title);

test('a Taak with only a title gets middel / binnenkort and nothing else', async () => {
  const { store } = setup();
  await store.refresh();

  saveDraft(store, { ...DEFAULTS, title: '  Dozen halen ' });

  const pending = byTitle(store, 'Dozen halen');
  assert.ok(pending, 'shows at once, before GitHub has it');
  await store.flush();
  await store.refresh();
  const saved = byTitle(store, 'Dozen halen');
  assert.equal(typeof saved?.number, 'number');
  assert.deepEqual(saved?.labels.sort(), ['prio: medium', 'urgency: soon']);
  assert.deepEqual(saved?.assignees, []);
  assert.equal(saved?.milestone, null);
  assert.equal(saved?.body, '');
});

test('a blank title saves nothing', async () => {
  const { store } = setup();
  await store.refresh();

  const ref = saveDraft(store, { ...DEFAULTS, title: '   ' });

  assert.equal(ref, null);
  assert.equal(store.getState().pending, 0);
});

test('saves the chosen Prio, Urgentie and everything under "meer"', async () => {
  const { server, store } = setup();
  const blocker = server.addIssue({ title: 'Sleutel ophalen' });
  await store.refresh();

  saveDraft(store, {
    title: 'Kasten opbouwen',
    body: 'Met de schroevendraaier van de buren',
    prio: 'hoog',
    urgentie: 'nu',
    mijlpaal: 1,
    toegewezen: ['tjaronee', 'partner'],
    blockedBy: [blocker.number],
    blocks: [],
  });
  await store.flush();
  await store.refresh();

  const saved = byTitle(store, 'Kasten opbouwen');
  assert.equal(saved?.body, 'Met de schroevendraaier van de buren');
  assert.deepEqual(saved?.labels.sort(), ['prio: high', 'urgency: now']);
  assert.deepEqual(saved?.assignees.map((a) => a.login), ['tjaronee', 'partner']);
  assert.deepEqual(saved?.milestone, { number: 1, title: 'Nieuw huis 2026' });
  assert.deepEqual(saved?.blockedBy, [blocker.number]);
});

/** @param {ReturnType<typeof createStore>} store */
const geblokkeerd = (store) =>
  takenList(store.getState().issues, { filters: ALL, search: '', me: 'tjaronee' }).blocked.map((r) => r.issue.title);

test('a new Taak that Blokkeert another shows on GitHub as blocking it, until the link is removed', async () => {
  const { server, store } = setup();
  const later = server.addIssue({ title: 'Kasten opbouwen' });
  await store.refresh();

  saveDraft(store, { ...DEFAULTS, title: 'Sleutel ophalen', blocks: [later.number] });
  const pending = store.getState().issues.find((i) => i.number === later.number);
  assert.equal(pending?.blockedBy.length, 1, 'the other Taak is Geblokkeerd at once');
  await store.flush();
  await store.refresh();

  const sleutel = /** @type {number} */ (byTitle(store, 'Sleutel ophalen')?.number);
  assert.deepEqual(server.blockersOf(later.number), [sleutel]);
  assert.deepEqual(geblokkeerd(store), ['Kasten opbouwen']);

  // What the detail screen of "Sleutel ophalen" does on ×.
  store.removeBlockedBy(later.number, sleutel);
  assert.deepEqual(geblokkeerd(store), [], 'freed at once');
  await store.flush();
  await store.refresh();
  assert.deepEqual(server.blockersOf(later.number), []);
});

test('can block a Taak on a Taak that is still being created', async () => {
  const { store } = setup();
  await store.refresh();

  const blockerRef = saveDraft(store, { ...DEFAULTS, title: 'Sleutel ophalen' });
  saveDraft(store, { ...DEFAULTS, title: 'Kasten opbouwen', blockedBy: [/** @type {string} */ (blockerRef)] });
  await store.flush();
  await store.refresh();

  const saved = byTitle(store, 'Kasten opbouwen');
  assert.deepEqual(saved?.blockedBy, [byTitle(store, 'Sleutel ophalen')?.number]);
});

/** @param {Partial<import('../src/data/model.js').Issue>} over @returns {import('../src/data/model.js').Issue} */
function issue(over) {
  const number = over.number ?? 1;
  return {
    ref: number, number, id: number, cid: null, title: '', body: '', state: 'open', stateReason: null,
    labels: [], assignees: [], milestone: null,
    blockedByCount: 0, blockedBy: [], comments: 0, createdAt: '', updatedAt: '', closedAt: null,
    ...over,
  };
}

/** @param {string} login */
const person = (login) => ({ login, avatarUrl: '' });

test('offers the open Mijlpalen to choose from, by name', () => {
  const milestones = [
    { number: 3, title: 'Verhuizen', state: /** @type {const} */ ('open'), description: '', dueOn: null },
    { number: 1, title: 'Nieuw huis 2026', state: /** @type {const} */ ('open'), description: '', dueOn: null },
    { number: 2, title: 'Bruiloft', state: /** @type {const} */ ('closed'), description: '', dueOn: null },
  ];

  const c = choices({ issues: [], milestones }, 'tjaronee');

  assert.deepEqual(c.mijlpalen, [{ number: 1, title: 'Nieuw huis 2026' }, { number: 3, title: 'Verhuizen' }]);
});

test('offers me first, then everyone who has been Toegewezen before', () => {
  const issues = [
    issue({ number: 1, assignees: [person('partner')], state: 'closed' }),
    issue({ number: 2, assignees: [person('Tjaronee'), person('partner')] }),
  ];
  assert.deepEqual(choices({ issues, milestones: [] }, 'tjaronee').people, ['tjaronee', 'partner']);
  assert.deepEqual(choices({ issues, milestones: [] }, 'partner').people, ['partner', 'Tjaronee']);
  assert.deepEqual(choices({ issues, milestones: [] }, '').people, ['partner', 'Tjaronee']);
});
