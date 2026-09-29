import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takenList, loadFilters, saveFilters, isFiltered, ALL } from '../src/taken.js';
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

/** @param {string} login */
const person = (login) => ({ login, avatarUrl: `https://avatars/${login}.png` });

/** @param {Issue[]} issues @param {Partial<Parameters<typeof takenList>[1]>} [options] */
function titles(issues, options = {}) {
  const { free, blocked } = takenList(issues, { filters: ALL, search: '', me: 'tjaronee', ...options });
  return { free: free.map((r) => r.issue.title), blocked: blocked.map((r) => r.issue.title) };
}

test('shows open Taken only: no Epics, Boodschappen or closed issues', () => {
  const list = [
    issue({ title: 'Meubels opmeten' }),
    issue({ title: 'Verhuizen', labels: ['Epic'] }),
    issue({ title: 'Opruimen', subIssues: { total: 2, completed: 0 } }),
    issue({ title: 'melk', labels: ['boodschappen'] }),
    issue({ title: 'Oud', state: 'closed', stateReason: 'completed' }),
  ];
  assert.deepEqual(titles(list).free, ['Meubels opmeten']);
});

test('sorts by Urgentie, then Prio; unlabelled counts as binnenkort / middel', () => {
  const list = [
    issue({ title: 'ooit hoog', labels: ['urgency: whenever', 'prio: high'] }),
    issue({ title: 'binnenkort laag', labels: ['urgency: soon', 'prio: low'] }),
    issue({ title: 'geen labels' }),
    issue({ title: 'nu laag', labels: ['urgency: now', 'prio: low'] }),
    issue({ title: 'binnenkort hoog', labels: ['prio: high'] }),
    issue({ title: 'nu hoog', labels: ['urgency: now', 'prio: high'] }),
  ];
  assert.deepEqual(titles(list).free, [
    'nu hoog',
    'nu laag',
    'binnenkort hoog',
    'geen labels',
    'binnenkort laag',
    'ooit hoog',
  ]);
});

test('equal Urgentie and Prio keeps the oldest first', () => {
  const list = [issue({ title: 'b', number: 30 }), issue({ title: 'a', number: 20 })];
  assert.deepEqual(titles(list).free, ['a', 'b']);
});

test('a row carries its Prio, Urgentie, assignees and Epic / Mijlpaal breadcrumb', () => {
  const epic = issue({ title: 'Verhuizen', labels: ['Epic'] });
  const taak = issue({
    title: 'Dozen halen',
    labels: ['prio: high'],
    parent: epic.number,
    milestone: { number: 1, title: 'Nieuw huis 2026' },
    assignees: [person('tjaronee')],
  });
  const [row] = takenList([epic, taak], { filters: ALL, search: '', me: 'tjaronee' }).free;
  assert.equal(row.prio, 'hoog');
  assert.equal(row.urgentie, 'binnenkort');
  assert.deepEqual(row.issue.assignees, [person('tjaronee')]);
  assert.deepEqual(row.breadcrumb, ['Verhuizen', 'Nieuw huis 2026']);
});

test('the breadcrumb leaves out whatever the Taak does not belong to', () => {
  const list = [
    issue({ title: 'los' }),
    issue({ title: 'alleen mijlpaal', milestone: { number: 1, title: 'Nieuw huis 2026' } }),
  ];
  const rows = takenList(list, { filters: ALL, search: '', me: 'tjaronee' }).free;
  assert.deepEqual(
    rows.map((r) => r.breadcrumb),
    [[], ['Nieuw huis 2026']],
  );
});

test('filters on Prio and Urgentie, each a multi-select, combined', () => {
  const list = [
    issue({ title: 'nu hoog', labels: ['urgency: now', 'prio: high'] }),
    issue({ title: 'nu laag', labels: ['urgency: now', 'prio: low'] }),
    issue({ title: 'ooit hoog', labels: ['urgency: whenever', 'prio: high'] }),
    issue({ title: 'middel binnenkort' }),
  ];
  assert.deepEqual(titles(list, { filters: { ...ALL, prio: ['hoog', 'middel'] } }).free, [
    'nu hoog',
    'middel binnenkort',
    'ooit hoog',
  ]);
  assert.deepEqual(titles(list, { filters: { ...ALL, prio: ['hoog'], urgentie: ['ooit', 'binnenkort'] } }).free, [
    'ooit hoog',
  ]);
});

test('"Mijn" is what I could pick up: mine plus unassigned; "Partner" the same from their side', () => {
  const list = [
    issue({ title: 'van mij', assignees: [person('tjaronee')] }),
    issue({ title: 'van partner', assignees: [person('partner')] }),
    issue({ title: 'samen', assignees: [person('partner'), person('tjaronee')] }),
    issue({ title: 'vrij' }),
  ];
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'mijn' } }).free, ['van mij', 'samen', 'vrij']);
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'partner' } }).free, ['van partner', 'samen', 'vrij']);
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'iedereen' } }).free.length, 4);
});

test('"Mijn" depends on who is signed in, ignoring case of the login', () => {
  const list = [issue({ title: 'van T', assignees: [person('Tjaronee')] }), issue({ title: 'van P', assignees: [person('partner')] })];
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'mijn' }, me: 'tjaronee' }).free, ['van T']);
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'mijn' }, me: 'partner' }).free, ['van P']);
});

test('Geblokkeerd Taken go to their own section, saying what they wait for', () => {
  const blocker = issue({ title: 'Sleutel ophalen', labels: ['urgency: whenever'] });
  const blocked = issue({ title: 'Verhuizen', labels: ['urgency: now'], blockedByCount: 1, blockedBy: [blocker.ref] });
  const { free, blocked: waiting } = takenList([blocker, blocked], { filters: ALL, search: '', me: 'tjaronee' });
  assert.deepEqual(
    free.map((r) => r.issue.title),
    ['Sleutel ophalen'],
  );
  assert.deepEqual(
    waiting.map((r) => [r.issue.title, r.waitingFor.map((w) => [w.ref, w.title])]),
    [['Verhuizen', [[blocker.ref, 'Sleutel ophalen']]]],
  );
});

test('a Taak returns to the list once every blocker is closed', () => {
  const a = issue({ title: 'a' });
  const b = issue({ title: 'b', state: 'closed', stateReason: 'completed' });
  const taak = issue({ title: 'taak', blockedByCount: 2, blockedBy: [a.ref, b.ref] });

  const partly = takenList([a, b, taak], { filters: ALL, search: '', me: 'tjaronee' });
  assert.deepEqual(partly.blocked.map((r) => r.waitingFor.map((w) => w.title)), [['a']]);

  const done = takenList([{ ...a, state: 'closed' }, b, taak], { filters: ALL, search: '', me: 'tjaronee' });
  assert.deepEqual(done.free.map((r) => r.issue.title), ['taak']);
  assert.equal(done.blocked.length, 0);
});

test('a blocker that is still being created counts, found by its client ID', () => {
  const pending = issue({ ref: 'cid-1', number: null, cid: 'cid-1', title: 'nieuw' });
  const taak = issue({ title: 'taak', blockedByCount: 1, blockedBy: ['cid-1'] });
  const { blocked } = takenList([pending, taak], { filters: ALL, search: '', me: 'tjaronee' });
  assert.deepEqual(blocked.map((r) => r.waitingFor.map((w) => w.ref)), [['cid-1']]);
});

test('the blocked section is filtered and sorted like the list', () => {
  const blocker = issue({ title: 'blocker' });
  const list = [
    blocker,
    issue({ title: 'ooit', labels: ['urgency: whenever'], blockedBy: [blocker.ref] }),
    issue({ title: 'nu', labels: ['urgency: now'], blockedBy: [blocker.ref] }),
    issue({ title: 'partner', labels: ['urgency: now'], assignees: [person('partner')], blockedBy: [blocker.ref] }),
  ];
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'mijn' } }).blocked, ['nu', 'ooit']);
});

test('search matches title and description, ignoring case and accents', () => {
  const list = [
    issue({ title: 'Café bellen' }),
    issue({ title: 'Meubels', body: 'Bank en TAFEL opmeten' }),
    issue({ title: 'Iets anders' }),
  ];
  assert.deepEqual(titles(list, { search: 'cafe' }).free, ['Café bellen']);
  assert.deepEqual(titles(list, { search: '  tafel ' }).free, ['Meubels']);
  assert.deepEqual(titles(list, { search: 'bank opmeten' }).free, ['Meubels']);
  assert.equal(titles(list, { search: '' }).free.length, 3);
});

test('filters are remembered on the device', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadFilters(storage), ALL);

  saveFilters(storage, { prio: ['hoog'], urgentie: ['nu', 'ooit'], wie: 'mijn' });

  assert.deepEqual(loadFilters(storage), { prio: ['hoog'], urgentie: ['nu', 'ooit'], wie: 'mijn' });
});

test('unreadable or outdated remembered filters fall back to showing everything', () => {
  const storage = memoryStorage();
  storage.setItem('nexus.takenFilters', '{not json');
  assert.deepEqual(loadFilters(storage), ALL);

  storage.setItem('nexus.takenFilters', JSON.stringify({ prio: ['heel hoog', 'laag'], urgentie: 'nu', wie: 'ik' }));
  assert.deepEqual(loadFilters(storage), { ...ALL, prio: ['laag'] });
});

test('knows whether any filter is on', () => {
  assert.equal(isFiltered(ALL), false);
  assert.equal(isFiltered({ ...ALL, prio: ['hoog'] }), true);
  assert.equal(isFiltered({ ...ALL, urgentie: ['nu'] }), true);
  assert.equal(isFiltered({ ...ALL, wie: 'mijn' }), true);
});
