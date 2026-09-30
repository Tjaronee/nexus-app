import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestions, addBoodschap } from '../src/boodschap-add.js';
import { createStore } from '../src/data/store.js';
import { createGitHub } from '../src/github.js';
import { createFakeGitHub } from './fake-github.js';
import { memoryStorage } from './memory-storage.js';

/** @typedef {import('../src/data/model.js').Issue} Issue */

let next = 1;

/** @param {Partial<Issue>} [over] @returns {Issue} */
function issue(over = {}) {
  const number = over.number ?? next++;
  return {
    ref: number,
    number,
    id: number * 10,
    cid: null,
    title: `Boodschap ${number}`,
    body: '',
    state: 'open',
    stateReason: null,
    labels: ['boodschappen'],
    assignees: [],
    milestone: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockedByCount: 0,
    blockedBy: [],
    comments: 0,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    closedAt: null,
    ...over,
  };
}

const bought = { state: /** @type {const} */ ('closed'), stateReason: /** @type {const} */ ('completed') };

/** @param {Issue[]} issues @param {string} query */
const titles = (issues, query) => suggestions(issues, query).map((s) => [s.issue.title, s.open]);

test('suggests earlier Boodschappen, open and closed, whose name contains what was typed', () => {
  const issues = [
    issue({ title: 'Melk', ...bought }),
    issue({ title: 'karnemelk' }),
    issue({ title: 'brood' }),
    issue({ title: 'Melkpoeder bestellen', labels: [] }),
  ];
  assert.deepEqual(titles(issues, 'melk'), [
    ['Melk', false],
    ['karnemelk', true],
  ]);
});

test('names that start with what was typed come first, ignoring case and accents', () => {
  const issues = [issue({ title: 'koffiecrème' }), issue({ title: 'Crème fraîche' }), issue({ title: 'creme brulee' })];
  assert.deepEqual(
    titles(issues, 'creme').map(([t]) => t),
    ['creme brulee', 'Crème fraîche', 'koffiecrème'],
  );
});

test('nothing typed suggests nothing; a Boodschap that was removed rather than bought is suggested too', () => {
  const issues = [issue({ title: 'melk', state: 'closed', stateReason: 'not_planned' })];
  assert.deepEqual(titles(issues, '  '), []);
  assert.deepEqual(titles(issues, 'mel'), [['melk', false]]);
});

test('each name is suggested once: the open one, else the last closed', () => {
  const issues = [
    issue({ title: 'melk', ...bought, updatedAt: '2026-09-01T00:00:00Z' }),
    issue({ number: 90, title: 'Melk', ...bought, updatedAt: '2026-09-20T00:00:00Z' }),
    issue({ title: 'kaas', ...bought }),
    issue({ number: 91, title: 'kaas' }),
  ];
  assert.deepEqual(
    suggestions(issues, 'melk').map((s) => s.issue.number),
    [90],
  );
  assert.deepEqual(
    suggestions(issues, 'kaas').map((s) => s.issue.number),
    [91],
  );
});

test('at most five suggestions', () => {
  const issues = Array.from({ length: 8 }, (_, i) => issue({ title: `appel ${i}` }));
  assert.equal(suggestions(issues, 'appel').length, 5);
});

/** @param {ReturnType<typeof createFakeGitHub>} server */
function phone(server) {
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  let n = 0;
  return createStore({ github, storage: memoryStorage(), newId: () => `cid-${++n}` });
}

/** Sends everything and fetches it back, as GitHub now has it. @param {ReturnType<typeof createStore>} store */
async function sync(store) {
  await store.flush();
  await store.refresh();
  return store.getState().issues;
}

const NONE = { note: '', plekken: /** @type {string[]} */ ([]) };

test('typing "melk" after it was bought last week reopens that issue with its old Plekken', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({
    title: 'melk', labels: ['boodschappen', 'waar: praxis'], state: 'closed', state_reason: 'completed', closed_at: '2026-09-22T10:00:00Z',
  });
  const store = phone(server);
  await store.refresh();

  const result = addBoodschap(store, { ...NONE, name: ' Melk ' });

  assert.equal(result?.outcome, 'terug');
  const issues = await sync(store);
  assert.equal(issues.length, 1, 'no new issue');
  assert.equal(issues[0].number, melk.number);
  assert.equal(issues[0].state, 'open');
  assert.deepEqual(issues[0].labels.sort(), ['boodschappen', 'waar: praxis']);
});

test('a new name becomes a new Boodschap with its Plekken and note', async () => {
  const server = createFakeGitHub();
  const store = phone(server);
  await store.refresh();

  const result = addBoodschap(store, { name: '  Blauwe   verf ', note: ' de blauwe ', plekken: ['Praxis', ''] });

  assert.equal(result?.outcome, 'nieuw');
  const [saved] = await sync(store);
  assert.equal(saved.title, 'Blauwe verf');
  assert.equal(saved.body, 'de blauwe');
  assert.deepEqual(saved.labels.sort(), ['boodschappen', 'waar: praxis']);
});

test('one that is already on the list is not added again, but gets the newly chosen Plek', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', labels: ['boodschappen', 'waar: praxis'] });
  const store = phone(server);
  await store.refresh();

  const result = addBoodschap(store, { name: 'melk', note: '', plekken: ['praxis', 'markt'] });

  assert.equal(result?.outcome, 'al-op-lijst');
  const issues = await sync(store);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].labels.sort(), ['boodschappen', 'waar: markt', 'waar: praxis']);
  assert.equal(issues[0].number, melk.number);
});

test('picking a suggestion uses that issue, whatever its name', async () => {
  const server = createFakeGitHub();
  const oud = server.addIssue({ title: 'Halfvolle melk', labels: ['boodschappen'], state: 'closed', state_reason: 'completed' });
  const store = phone(server);
  await store.refresh();

  const result = addBoodschap(store, { ...NONE, name: 'melk' }, oud.number);

  assert.equal(result?.outcome, 'terug');
  const issues = await sync(store);
  assert.deepEqual(issues.map((i) => [i.title, i.state]), [['Halfvolle melk', 'open']]);
});

test('bringing one back with a note replaces its old note; without one it keeps it', async () => {
  const server = createFakeGitHub();
  const closed = { labels: ['boodschappen'], state: 'closed', state_reason: 'completed' };
  server.addIssue({ title: 'eieren', body: '6 stuks', ...closed });
  server.addIssue({ title: 'kaas', body: 'jong', ...closed });
  const store = phone(server);
  await store.refresh();

  addBoodschap(store, { ...NONE, name: 'eieren', note: '12 stuks' });
  addBoodschap(store, { ...NONE, name: 'kaas' });

  const issues = await sync(store);
  assert.deepEqual(issues.map((i) => [i.title, i.body]), [['eieren', '12 stuks'], ['kaas', 'jong']]);
});

test('a blank name saves nothing', async () => {
  const store = phone(createFakeGitHub());
  await store.refresh();
  assert.equal(addBoodschap(store, { ...NONE, name: '   ' }), null);
  assert.equal(store.getState().pending, 0);
});

/** @param {ReturnType<typeof createFakeGitHub>} server */
const labelPosts = (server) => server.state.log.filter((l) => l.method === 'POST' && l.path.endsWith('/labels') && !l.path.includes('/issues/'));

test('a new Plek label is created first; labels Nexus already has are not', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', labels: ['boodschappen'] });
  const store = phone(server);
  await store.refresh();

  addBoodschap(store, { name: 'melk', note: '', plekken: ['markt'] });
  addBoodschap(store, { name: 'kaas', note: '', plekken: ['markt', 'praxis'] });
  await sync(store);

  assert.deepEqual(labelPosts(server).map((l) => l.status), [201]);
  assert.deepEqual(store.getState().labels.filter((l) => l.startsWith('waar: ')).sort(), ['waar: markt', 'waar: praxis']);
  assert.ok(store.getState().issues.find((i) => i.number === melk.number)?.labels.includes('waar: markt'));
});

test('a label that turns out to exist already counts as created', async () => {
  const server = createFakeGitHub();
  const store = phone(server);
  // Not refreshed yet, so the app doesn't know Nexus has these labels.

  addBoodschap(store, { name: 'schroeven', note: '', plekken: ['praxis'] });
  const issues = await sync(store);

  assert.ok(labelPosts(server).length > 0 && labelPosts(server).every((l) => l.status === 422));
  assert.deepEqual(issues.map((i) => i.labels.sort()), [['boodschappen', 'waar: praxis']]);
});
