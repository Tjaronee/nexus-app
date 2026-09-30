import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boodschappenList, normalisePlek, saveBoodschap, plekChoices, knownPlekken } from '../src/boodschappen.js';
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

/** @param {string} title @param {string[]} plekken @param {Partial<Issue>} [over] */
const boodschap = (title, plekken = [], over = {}) =>
  issue({ title, labels: ['boodschappen', ...plekken.map((p) => `waar: ${p}`)], ...over });

const OPENED = '2026-09-29T12:00:00Z';

/** @param {Issue[]} issues @param {Partial<Parameters<typeof boodschappenList>[1]>} [options] */
const list = (issues, options = {}) => boodschappenList(issues, { zoom: null, mandjeSince: OPENED, ...options });

/** @param {ReturnType<typeof list>} view */
const groups = (view) => view.groups.map((g) => [g.plek, g.items.map((i) => i.issue.title)]);

test('groups the open Boodschappen by Plek, alphabetically, with "Geen plek" last', () => {
  const issues = [
    boodschap('schroeven', ['praxis']),
    boodschap('melk'),
    boodschap('verf', ['praxis', 'centrum']),
    boodschap('brood', ['centrum']),
    boodschap('oud', ['praxis'], { state: 'closed', stateReason: 'completed' }),
    issue({ title: 'Een Taak', labels: [] }),
  ];
  assert.deepEqual(groups(list(issues)), [
    ['centrum', ['brood', 'verf']],
    ['praxis', ['schroeven', 'verf']],
    [null, ['melk']],
  ]);
});

test('a quantity or note shows as one line', () => {
  const [group] = list([boodschap('melk', [], { body: ' 2 liter\nhalfvol \n' })]).groups;
  assert.equal(group.items[0].note, '2 liter · halfvol');
});

test('chips count the open Boodschappen per Plek, after "Alles"', () => {
  const issues = [
    boodschap('schroeven', ['praxis']),
    boodschap('verf', ['praxis', 'centrum']),
    boodschap('melk'),
    boodschap('gekocht', ['markt'], { state: 'closed', stateReason: 'completed' }),
  ];
  assert.deepEqual(
    list(issues).chips.map((c) => [c.zoom, c.count, c.selected]),
    [
      [null, 3, true],
      [{ plek: 'centrum' }, 1, false],
      [{ plek: 'praxis' }, 2, false],
      [{ plek: null }, 1, false],
    ],
  );
});

test('zooming in on a Plek shows only its group', () => {
  const issues = [boodschap('schroeven', ['praxis']), boodschap('brood', ['centrum']), boodschap('melk')];
  assert.deepEqual(groups(list(issues, { zoom: { plek: 'praxis' } })), [['praxis', ['schroeven']]]);
  assert.deepEqual(groups(list(issues, { zoom: { plek: null } })), [[null, ['melk']]]);
});

test('In het mandje holds what was bought since the app opened, last ticked first; removed ones are not in it', () => {
  const bought = { state: /** @type {const} */ ('closed'), stateReason: /** @type {const} */ ('completed') };
  const issues = [
    boodschap('vorige keer', [], { ...bought, closedAt: '2026-09-28T09:00:00Z' }),
    boodschap('melk', [], { ...bought, closedAt: '2026-09-29T12:05:00Z' }),
    boodschap('brood', ['bakker'], { ...bought, closedAt: '2026-09-29T12:10:00Z' }),
    boodschap('weg', [], { state: 'closed', stateReason: 'not_planned', closedAt: '2026-09-29T12:07:00Z' }),
    boodschap('kaas'),
  ];
  const view = list(issues);
  assert.deepEqual(
    view.mandje.map((i) => i.issue.title),
    ['brood', 'melk'],
  );
  assert.deepEqual(groups(view), [[null, ['kaas']]]);

  assert.deepEqual(list(issues, { mandjeSince: '2026-09-29T12:08:00Z' }).mandje.map((i) => i.issue.title), ['brood']);
});

test('zoomed in, In het mandje shows only what belongs to that Plek', () => {
  const bought = { state: /** @type {const} */ ('closed'), stateReason: /** @type {const} */ ('completed'), closedAt: '2026-09-29T12:05:00Z' };
  const issues = [boodschap('brood', ['bakker'], bought), boodschap('melk', [], bought)];
  assert.deepEqual(
    list(issues, { zoom: { plek: 'bakker' } }).mandje.map((i) => i.issue.title),
    ['brood'],
  );
});

test('the zoomed-in Plek keeps its chip and group when its last Boodschap is bought', () => {
  const issues = [boodschap('schroeven', ['praxis'], { state: 'closed', stateReason: 'completed', closedAt: OPENED })];
  const view = list(issues, { zoom: { plek: 'praxis' } });
  assert.deepEqual(
    view.chips.map((c) => [c.zoom, c.count, c.selected]),
    [
      [null, 0, false],
      [{ plek: 'praxis' }, 0, true],
    ],
  );
  assert.deepEqual(groups(view), [['praxis', []]]);
});

/** A phone: its own store, talking to the shared fake GitHub. @param {ReturnType<typeof createFakeGitHub>} server */
function phone(server) {
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  return createStore({ github, storage: memoryStorage() });
}

/** @param {ReturnType<typeof createStore>} store @param {number} number */
const find = (store, number) => store.getState().issues.find((i) => i.number === number);

test('Plek names are trimmed, lowercased and their spaces collapsed', () => {
  assert.equal(normalisePlek('  Albert   Heijn '), 'albert heijn');
});

test('editing a Boodschap saves its name, quantity or note, and Plekken', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', labels: ['boodschappen', 'waar: praxis', 'waar: markt'] });
  const store = phone(server);
  await store.refresh();

  saveBoodschap(store, melk.number, { title: ' Melk ', note: '2 liter ', plekken: ['markt', ' Albert  Heijn', 'albert heijn', ''] });

  await store.flush();
  await store.refresh();
  const saved = find(store, melk.number);
  assert.equal(saved?.title, 'Melk');
  assert.equal(saved?.body, '2 liter');
  assert.deepEqual(saved?.labels.sort(), ['boodschappen', 'waar: albert heijn', 'waar: markt']);
});

test('saving an unchanged Boodschap sends nothing, and a blank name is refused', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', body: '2 liter', labels: ['boodschappen', 'waar: praxis'] });
  const store = phone(server);
  await store.refresh();

  assert.equal(saveBoodschap(store, melk.number, { title: 'melk', note: '2 liter', plekken: ['praxis'] }), true);
  assert.equal(saveBoodschap(store, melk.number, { title: '  ', note: '', plekken: [] }), false);
  assert.equal(store.getState().pending, 0);
});

test('two phones ticking off at the same time both end up with everything In het mandje', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', labels: ['boodschappen', 'waar: praxis'] });
  const brood = server.addIssue({ title: 'brood', labels: ['boodschappen', 'waar: praxis'] });
  const kaas = server.addIssue({ title: 'kaas', labels: ['boodschappen', 'waar: praxis'] });
  const mine = phone(server);
  const theirs = phone(server);
  await Promise.all([mine.refresh(), theirs.refresh()]);

  mine.close(melk.number, 'completed');
  theirs.close(brood.number, 'completed');
  await Promise.all([mine.flush(), theirs.flush()]);
  await Promise.all([mine.refresh(), theirs.refresh()]);

  for (const store of [mine, theirs]) {
    const view = boodschappenList(store.getState().issues, { zoom: { plek: 'praxis' }, mandjeSince: '2026-01-01T00:00:00Z' });
    assert.deepEqual(view.mandje.map((i) => i.issue.title).sort(), ['brood', 'melk']);
    assert.deepEqual(groups(view), [['praxis', ['kaas']]]);
  }
  assert.equal(find(mine, kaas.number)?.state, 'open');
});

test('the edit sheet offers every known Plek, alphabetically', () => {
  const melk = boodschap('melk', ['zeeman']);
  assert.deepEqual(plekChoices(['Epic', 'waar: praxis', 'boodschappen', 'waar: centrum'], melk), ['centrum', 'praxis', 'zeeman']);
});

test("what was ticked on this phone stays In het mandje, even if GitHub's clock says it was before", () => {
  const melk = boodschap('melk', [], { state: 'closed', stateReason: 'completed', closedAt: '2026-09-29T11:59:00Z' });
  assert.deepEqual(list([melk]).mandje, []);
  assert.deepEqual(
    list([melk], { tickedHere: [melk.ref] }).mandje.map((i) => i.issue.title),
    ['melk'],
  );
});

test('a Plek label written in capitals is kept, not removed and added again', async () => {
  const server = createFakeGitHub();
  const melk = server.addIssue({ title: 'melk', labels: ['boodschappen', 'waar: Praxis'] });
  const store = phone(server);
  await store.refresh();

  saveBoodschap(store, melk.number, { title: 'melk', note: '', plekken: ['praxis'] });

  assert.equal(store.getState().pending, 0);
});

test("a Plek name is cut to 44 characters, so its label fits GitHub's 50", () => {
  const plek = normalisePlek(`${'a'.repeat(40)}  bcdefgh `);
  assert.equal(plek, `${'a'.repeat(40)} bcd`);
  assert.equal(`waar: ${plek}`.length, 50);
});

test('two open Boodschappen with the same name are both marked as possibly double', () => {
  const issues = [boodschap('Melk', ['praxis']), boodschap(' melk'), boodschap('kaas'), boodschap('melk', [], { state: 'closed', stateReason: 'completed' })];
  const view = list(issues);
  assert.deepEqual(
    view.groups.flatMap((g) => g.items.map((i) => [g.plek, i.issue.title, i.double])),
    [
      ['praxis', 'Melk', true],
      [null, 'kaas', false],
      [null, ' melk', true],
    ],
  );
});

test('known Plekken are listed as normalised, once each', () => {
  assert.deepEqual(knownPlekken(['waar: Praxis', 'waar: praxis', 'waar: Albert  Heijn'], [boodschap('melk', ['PRAXIS'])]), ['albert heijn', 'praxis']);
});
