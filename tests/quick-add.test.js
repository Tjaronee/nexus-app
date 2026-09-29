import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveTaak, choices, DEFAULTS } from '../src/quick-add.js';
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

  saveTaak(store, { ...DEFAULTS, title: '  Dozen halen ' });

  const pending = byTitle(store, 'Dozen halen');
  assert.ok(pending, 'shows at once, before GitHub has it');
  await store.flush();
  await store.refresh();
  const saved = byTitle(store, 'Dozen halen');
  assert.equal(typeof saved?.number, 'number');
  assert.deepEqual(saved?.labels.sort(), ['prio: medium', 'urgency: soon']);
  assert.deepEqual(saved?.assignees, []);
  assert.equal(saved?.milestone, null);
  assert.equal(saved?.parent, null);
  assert.equal(saved?.body, '');
});

test('a blank title saves nothing', async () => {
  const { store } = setup();
  await store.refresh();

  const ref = saveTaak(store, { ...DEFAULTS, title: '   ' });

  assert.equal(ref, null);
  assert.equal(store.getState().pending, 0);
});

test('saves the chosen Prio, Urgentie and everything under "meer"', async () => {
  const { server, store } = setup();
  const epic = server.addIssue({ title: 'Verhuizen', labels: ['Epic'] });
  const blocker = server.addIssue({ title: 'Sleutel ophalen' });
  await store.refresh();

  saveTaak(store, {
    title: 'Kasten opbouwen',
    body: 'Met de schroevendraaier van de buren',
    prio: 'hoog',
    urgentie: 'nu',
    epic: epic.number,
    mijlpaal: 1,
    toegewezen: ['tjaronee', 'partner'],
    blockedBy: [blocker.number],
  });
  await store.flush();
  await store.refresh();

  const saved = byTitle(store, 'Kasten opbouwen');
  assert.equal(saved?.body, 'Met de schroevendraaier van de buren');
  assert.deepEqual(saved?.labels.sort(), ['prio: high', 'urgency: now']);
  assert.deepEqual(saved?.assignees.map((a) => a.login), ['tjaronee', 'partner']);
  assert.deepEqual(saved?.milestone, { number: 1, title: 'Nieuw huis 2026' });
  assert.equal(saved?.parent, epic.number);
  assert.deepEqual(saved?.blockedBy, [blocker.number]);
});

test('can hang a Taak under an Epic, and block it on a Taak, that are still being created', async () => {
  const { store } = setup();
  await store.refresh();

  const epicRef = store.create({ title: 'Verhuizen', labels: ['Epic'] });
  const blockerRef = saveTaak(store, { ...DEFAULTS, title: 'Sleutel ophalen' });
  saveTaak(store, { ...DEFAULTS, title: 'Kasten opbouwen', epic: epicRef, blockedBy: [/** @type {string} */ (blockerRef)] });
  await store.flush();
  await store.refresh();

  const saved = byTitle(store, 'Kasten opbouwen');
  assert.equal(saved?.parent, byTitle(store, 'Verhuizen')?.number);
  assert.deepEqual(saved?.blockedBy, [byTitle(store, 'Sleutel ophalen')?.number]);
});

/** @param {Partial<import('../src/data/model.js').Issue>} over @returns {import('../src/data/model.js').Issue} */
function issue(over) {
  const number = over.number ?? 1;
  return {
    ref: number, number, id: number, cid: null, title: '', body: '', state: 'open', stateReason: null,
    labels: [], assignees: [], milestone: null, parent: null, subIssues: { total: 0, completed: 0 },
    blockedByCount: 0, blockedBy: [], comments: 0, createdAt: '', updatedAt: '', closedAt: null,
    ...over,
  };
}

/** @param {string} login */
const person = (login) => ({ login, avatarUrl: '' });

test('offers open Epics, open Mijlpalen and open Taken to choose from, by name', () => {
  const issues = [
    issue({ number: 1, title: 'Verhuizen', labels: ['Epic'] }),
    issue({ number: 2, title: 'Afgerond', labels: ['Epic'], state: 'closed' }),
    issue({ number: 3, title: 'Tuin', subIssues: { total: 1, completed: 0 } }),
    issue({ number: 4, title: 'Zolder leeg' }),
    issue({ number: 5, title: 'Behang kopen' }),
    issue({ number: 6, title: 'Klaar', state: 'closed' }),
    issue({ number: 7, title: 'melk', labels: ['boodschappen'] }),
  ];
  const milestones = [
    { number: 1, title: 'Nieuw huis 2026', state: /** @type {const} */ ('open'), description: '', dueOn: null },
    { number: 2, title: 'Bruiloft', state: /** @type {const} */ ('closed'), description: '', dueOn: null },
  ];

  const c = choices({ issues, milestones }, 'tjaronee');

  assert.deepEqual(c.epics, [{ ref: 3, title: 'Tuin' }, { ref: 1, title: 'Verhuizen' }]);
  assert.deepEqual(c.mijlpalen, [{ number: 1, title: 'Nieuw huis 2026' }]);
  assert.deepEqual(c.blockers, [{ ref: 5, title: 'Behang kopen' }, { ref: 4, title: 'Zolder leeg' }]);
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
