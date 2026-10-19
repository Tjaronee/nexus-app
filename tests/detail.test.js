import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailOf, assigneeChange, editChoices, reactieBody, postReactie, tapSoortChip } from '../src/detail.js';
import { createStore } from '../src/data/store.js';
import { createGitHub } from '../src/github.js';
import { createFakeGitHub } from './fake-github.js';
import { memoryStorage } from './memory-storage.js';

/** @typedef {import('../src/data/model.js').Issue} Issue */

/** @param {Partial<Issue>} over @returns {Issue} */
function issue(over) {
  const number = over.number ?? 1;
  return {
    ref: number, number, id: number, cid: null, title: `Taak ${number}`, body: '', state: 'open', stateReason: null,
    labels: [], assignees: [], milestone: null,
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

test('the pickers show what the Taak has now, even a closed Mijlpaal', () => {
  const taak = issue({ number: 3, milestone: { number: 9, title: 'Bruiloft' }, assignees: [{ login: 'Tjaronee', avatarUrl: '' }] });
  const milestones = [{ number: 1, title: 'Nieuw huis 2026', state: /** @type {const} */ ('open'), description: '', dueOn: null }];

  const c = editChoices({ issues: [taak], milestones }, taak, 'tjaronee');

  assert.deepEqual(c.mijlpalen.map((m) => m.title), ['Nieuw huis 2026', 'Bruiloft']);
  assert.equal(c.mijlpaal, 1);
  assert.deepEqual(c.people, ['tjaronee']);
  assert.deepEqual(c.toegewezen, ['tjaronee']);
});

test('the pickers show nothing chosen for a Taak without Mijlpaal or people', () => {
  const taak = issue({ number: 3 });
  const c = editChoices({ issues: [taak], milestones: [] }, taak, 'tjaronee');
  assert.equal(c.mijlpaal, -1);
  assert.deepEqual(c.toegewezen, []);
});

test('someone Toegewezen who is not offered yet is added to the people', () => {
  const taak = issue({ number: 3, assignees: [{ login: 'gast', avatarUrl: '' }] });
  const c = editChoices({ issues: [], milestones: [] }, taak, 'tjaronee');
  assert.deepEqual(c.people, ['tjaronee', 'gast']);
  assert.deepEqual(c.toegewezen, ['gast']);
});

// Reacties

function storeSetup() {
  const server = createFakeGitHub();
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  let n = 0;
  const store = createStore({ github, storage: memoryStorage(), newId: () => `cid-${++n}` });
  return { server, store };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** @param {string} body */
const withoutCid = (body) => body.replace(/\s*<!-- cid:.* -->$/, '');

test('a Reactie is the typed text, trimmed; only whitespace is no Reactie', () => {
  assert.equal(reactieBody('  gebeld, ze bellen terug \n'), 'gebeld, ze bellen terug');
  assert.equal(reactieBody('- [ ] terugbellen\n- [x] mailen'), '- [ ] terugbellen\n- [x] mailen');
  assert.equal(reactieBody(''), null);
  assert.equal(reactieBody(' \n\t '), null);
});

test('posting a Reactie shows it as wordt verstuurd until the queue has sent it', async () => {
  const { server, store } = storeSetup();
  const taak = server.addIssue({ title: 'Makelaar bellen' });
  await store.refresh();
  await store.loadComments(taak.number);

  assert.equal(postReactie(store, taak.number, ' gebeld, ze bellen terug '), true);
  assert.deepEqual(store.comments(taak.number).map((c) => [c.body, c.pending]), [['gebeld, ze bellen terug', true]]);

  await store.flush();
  assert.deepEqual(server.comments.get(taak.number)?.map((c) => withoutCid(c.body)), ['gebeld, ze bellen terug']);
  assert.deepEqual(store.comments(taak.number).map((c) => [c.body, c.pending]), [['gebeld, ze bellen terug', false]]);
});

test('an empty Reactie posts nothing', () => {
  const { store } = storeSetup();
  assert.equal(postReactie(store, 1, '   '), false);
  assert.equal(store.getState().pending, 0);
});

test('a Reactie written offline waits, and is sent once the phone is back online', async (t) => {
  const { server, store } = storeSetup();
  const taak = server.addIssue({ title: 'Makelaar bellen' });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = store.start({ win, doc, intervalMs: 20_000 });
  await settle();

  server.state.offline = true;
  postReactie(store, taak.number, 'gebeld, ze bellen terug');
  await settle();
  assert.equal(server.comments.get(taak.number)?.length ?? 0, 0);
  assert.deepEqual(store.comments(taak.number).map((c) => c.pending), [true]);

  server.state.offline = false;
  win.dispatchEvent(new Event('online'));
  await settle();
  await store.flush();

  assert.deepEqual(server.comments.get(taak.number)?.map((c) => withoutCid(c.body)), ['gebeld, ze bellen terug']);
  assert.deepEqual(store.comments(taak.number).map((c) => [c.body, c.pending]), [['gebeld, ze bellen terug', false]]);
  stop();
});

// Soort

test('reads the Soort of the Taak, or none', () => {
  assert.equal(detailOf([issue({ number: 1, labels: ['soort: Klusjes'] })], 1)?.soort, 'klusjes');
  assert.equal(detailOf([issue({ number: 1 })], 1)?.soort, null);
});

test('offers every known Soort, with the Taak\'s own even if its label is gone', () => {
  const taak = issue({ number: 3, state: 'closed', labels: ['soort: tuin'] });
  const c = editChoices({ issues: [taak], milestones: [], labels: ['soort: sociaal', 'soort: klusjes'] }, taak, 'tjaronee');
  assert.deepEqual(c.soorten, ['klusjes', 'sociaal', 'tuin']);
});

/** The labels GitHub has on a seeded issue. @param {Record<string, any>} seeded */
const serverLabels = (seeded) => seeded.labels.map((/** @type {{ name: string }} */ l) => l.name).sort();

test('tapping another Soort chip moves the Taak there: one label removed, one added', async () => {
  const { server, store } = storeSetup();
  const taak = server.addIssue({ title: 'Lamp ophangen', labels: ['prio: high', 'soort: sociaal'] });
  await store.refresh();

  tapSoortChip(store, taak.number, 'klusjes');

  assert.equal(detailOf(store.getState().issues, taak.number)?.soort, 'klusjes', 'shows at once');
  await store.flush();
  assert.deepEqual(serverLabels(taak), ['prio: high', 'soort: klusjes']);
});

test('tapping the chosen Soort chip clears it: Geen soort', async () => {
  const { server, store } = storeSetup();
  const taak = server.addIssue({ title: 'Lamp ophangen', labels: ['prio: high', 'soort: klusjes'] });
  await store.refresh();

  tapSoortChip(store, taak.number, 'klusjes');

  assert.equal(detailOf(store.getState().issues, taak.number)?.soort, null);
  await store.flush();
  assert.deepEqual(serverLabels(taak), ['prio: high']);
});

test('a Taak with two hand-made soort: labels ends with exactly the chosen one', async () => {
  const { server, store } = storeSetup();
  const taak = server.addIssue({ title: 'Lamp ophangen', labels: ['soort: sociaal', 'soort: klusjes'] });
  await store.refresh();

  tapSoortChip(store, taak.number, 'tuin');

  await store.flush();
  assert.deepEqual(serverLabels(taak), ['soort: tuin']);
});
