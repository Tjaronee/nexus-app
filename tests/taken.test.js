import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takenList, loadFilters, saveFilters, isFiltered, withKnownSoorten, ALL } from '../src/taken.js';
import { groupBySoort } from '../src/soort.js';
import { toIssue } from '../src/data/model.js';
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
  const { free, blocked, parked } = takenList(issues, opts(options));
  return { free: free.map((r) => r.issue.title), blocked: blocked.map((r) => r.issue.title), parked: parked.map((r) => r.issue.title) };
}

/** 8 November 2026, on the phone's clock. */
const TODAY = new Date(2026, 10, 8, 12);

/** takenList's options: everything, for tjaronee, today. @param {Partial<Parameters<typeof takenList>[1]>} [options] */
const opts = (options = {}) => ({ filters: ALL, search: '', me: 'tjaronee', today: TODAY, ...options });

test('shows open Taken only: no Boodschappen, Pakketten or closed issues', () => {
  const list = [
    issue({ title: 'Meubels opmeten' }),
    issue({ title: 'melk', labels: ['boodschappen'] }),
    issue({ title: 'Stofzuiger', labels: ['pakket'] }),
    issue({ title: 'Oud', state: 'closed', stateReason: 'completed' }),
  ];
  assert.deepEqual(titles(list).free, ['Meubels opmeten']);
});

test('an issue with sub-issues or the old Epic label, and its sub-issues, are ordinary Taken', () => {
  // As GitHub sends them: the sub-issue links are still there, and ignored.
  const raw = (/** @type {object} */ over) =>
    toIssue({ state: 'open', labels: [], created_at: '2026-09-01T10:00:00Z', ...over });
  const list = [
    raw({ number: 1, title: 'Verhuizen', labels: [{ name: 'Epic' }] }),
    raw({ number: 2, title: 'Opruimen', sub_issues_summary: { total: 1, completed: 0 } }),
    raw({ number: 3, title: 'Zolder', parent_issue_url: 'https://api.github.com/repos/Tjaronee/Nexus/issues/2' }),
  ];
  assert.deepEqual(titles(list).free, ['Verhuizen', 'Opruimen', 'Zolder']);
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

test('a row carries its Prio, Urgentie and assignees', () => {
  const taak = issue({
    title: 'Dozen halen',
    labels: ['prio: high'],
    assignees: [person('tjaronee')],
  });
  const [row] = takenList([taak], opts()).free;
  assert.equal(row.prio, 'hoog');
  assert.equal(row.urgentie, 'binnenkort');
  assert.deepEqual(row.issue.assignees, [person('tjaronee')]);
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
  const { free, blocked: waiting } = takenList([blocker, blocked], opts());
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

  const partly = takenList([a, b, taak], opts());
  assert.deepEqual(partly.blocked.map((r) => r.waitingFor.map((w) => w.title)), [['a']]);

  const done = takenList([{ ...a, state: 'closed' }, b, taak], opts());
  assert.deepEqual(done.free.map((r) => r.issue.title), ['taak']);
  assert.equal(done.blocked.length, 0);
});

test('a blocker that is still being created counts, found by its client ID', () => {
  const pending = issue({ ref: 'cid-1', number: null, cid: 'cid-1', title: 'nieuw' });
  const taak = issue({ title: 'taak', blockedByCount: 1, blockedBy: ['cid-1'] });
  const { blocked } = takenList([pending, taak], opts());
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

test('search never finds a Pakket', () => {
  const list = [issue({ title: 'Lamp ophangen' }), issue({ title: 'Lamp', labels: ['pakket'] })];
  assert.deepEqual(titles(list, { search: 'lamp' }).free, ['Lamp ophangen']);
});

test('filters are remembered on the device', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadFilters(storage), ALL);

  saveFilters(storage, { prio: ['hoog'], urgentie: ['nu', 'ooit'], wie: 'mijn', soort: ['klusjes', null] });

  assert.deepEqual(loadFilters(storage), { prio: ['hoog'], urgentie: ['nu', 'ooit'], wie: 'mijn', soort: ['klusjes', null] });
});

test('unreadable or outdated remembered filters fall back to showing everything', () => {
  const storage = memoryStorage();
  storage.setItem('nexus.takenFilters', '{not json');
  assert.deepEqual(loadFilters(storage), ALL);

  storage.setItem('nexus.takenFilters', JSON.stringify({ prio: ['heel hoog', 'laag'], urgentie: 'nu', wie: 'ik' }));
  assert.deepEqual(loadFilters(storage), { ...ALL, prio: ['laag'] });

  storage.setItem('nexus.takenFilters', JSON.stringify({ soort: ['Huishouden', 3, null] }));
  assert.deepEqual(loadFilters(storage).soort, ['huishouden', null]);
});

test('a remembered Soort that no longer exists is dropped silently', () => {
  const storage = memoryStorage();
  saveFilters(storage, { ...ALL, soort: ['huishouden', 'weg', null] });
  assert.deepEqual(withKnownSoorten(loadFilters(storage), ['huishouden', 'sociaal']).soort, ['huishouden', null]);
  // With no Soorten at all there is no Soort row, so nothing can be filtered on.
  assert.deepEqual(withKnownSoorten(loadFilters(storage), []).soort, []);
});

test('knows whether any filter is on', () => {
  assert.equal(isFiltered(ALL), false);
  assert.equal(isFiltered({ ...ALL, prio: ['hoog'] }), true);
  assert.equal(isFiltered({ ...ALL, urgentie: ['nu'] }), true);
  assert.equal(isFiltered({ ...ALL, wie: 'mijn' }), true);
  assert.equal(isFiltered({ ...ALL, soort: [null] }), true);
});

/** @param {Issue[]} issues @param {Partial<Parameters<typeof takenList>[1]>} [options] */
function grouped(issues, options = {}) {
  const { free } = takenList(issues, opts(options));
  return groupBySoort(free).map((g) => [g.soort, g.rows.map((r) => r.issue.title)]);
}

test('the free Taken are grouped per Soort, alphabetically, Geen soort last, sorted within', () => {
  const list = [
    issue({ title: 'zonder', labels: ['urgency: now'] }),
    issue({ title: 'feest ooit', labels: ['soort: sociaal', 'urgency: whenever'] }),
    issue({ title: 'stofzuigen', labels: ['soort: huishouden'] }),
    issue({ title: 'feest nu', labels: ['soort: sociaal', 'urgency: now', 'prio: low'] }),
    issue({ title: 'bellen nu hoog', labels: ['soort: Sociaal', 'urgency: now', 'prio: high'] }),
  ];
  assert.deepEqual(grouped(list), [
    ['huishouden', ['stofzuigen']],
    ['sociaal', ['bellen nu hoog', 'feest nu', 'feest ooit']],
    [null, ['zonder']],
  ]);
});

test('a Taak with two Soorten is shown once, in the alphabetically first', () => {
  const list = [issue({ title: 'beide', labels: ['soort: sociaal', 'soort: klusjes'] })];
  assert.deepEqual(grouped(list), [['klusjes', ['beide']]]);
});

test('the Soort filter is a multi-select that also filters Geblokkeerd', () => {
  const blocker = issue({ title: 'blocker', labels: ['soort: werk'] });
  const list = [
    blocker,
    issue({ title: 'stofzuigen', labels: ['soort: huishouden'] }),
    issue({ title: 'kast', labels: ['soort: klusjes'] }),
    issue({ title: 'feest', labels: ['soort: sociaal'] }),
    issue({ title: 'zonder' }),
    issue({ title: 'plank', labels: ['soort: klusjes'], blockedBy: [blocker.ref] }),
    issue({ title: 'etentje', labels: ['soort: sociaal'], blockedBy: [blocker.ref] }),
  ];
  const filters = { ...ALL, soort: ['huishouden', 'klusjes'] };
  assert.deepEqual(grouped(list, { filters }), [
    ['huishouden', ['stofzuigen']],
    ['klusjes', ['kast']],
  ]);
  assert.deepEqual(titles(list, { filters }).blocked, ['plank']);
  assert.deepEqual(titles(list, { filters: { ...ALL, soort: [null] } }), { free: ['zonder'], blocked: [], parked: [] });
});

test('Geparkeerd Taken are in their own section, not in the list or Geblokkeerd', () => {
  const blocker = issue({ title: 'blocker' });
  const list = [
    blocker,
    issue({ title: 'zonnepanelen', labels: ['geparkeerd: 2027-02', 'soort: klusjes'] }),
    issue({ title: 'geparkeerd en geblokkeerd', labels: ['geparkeerd: 2027-01'], blockedBy: [blocker.ref] }),
    issue({ title: 'geblokkeerd', blockedBy: [blocker.ref] }),
  ];
  assert.deepEqual(titles(list), {
    free: ['blocker'],
    blocked: ['geblokkeerd'],
    parked: ['geparkeerd en geblokkeerd', 'zonnepanelen'],
  });
});

test('from the first of its month a Taak is back in the list', () => {
  const list = [issue({ title: 'zonnepanelen', labels: ['geparkeerd: 2026-12'] }), issue({ title: 'oud', labels: ['geparkeerd: 2026-03'] })];
  assert.deepEqual(titles(list), { free: ['oud'], blocked: [], parked: ['zonnepanelen'] });
  assert.deepEqual(titles(list, { today: new Date(2026, 10, 30, 23, 59) }).parked, ['zonnepanelen']);
  assert.deepEqual(titles(list, { today: new Date(2026, 11, 1, 0, 0) }), { free: ['zonnepanelen', 'oud'], blocked: [], parked: [] });
});

test('the Geparkeerd section is sorted by month, then like the list, and each row knows its month', () => {
  const list = [
    issue({ title: 'maart', labels: ['geparkeerd: 2027-03', 'urgency: now'] }),
    issue({ title: 'februari ooit', labels: ['geparkeerd: 2027-02', 'urgency: whenever'] }),
    issue({ title: 'februari nu laag', labels: ['geparkeerd: 2027-02', 'urgency: now', 'prio: low'] }),
    issue({ title: 'februari nu hoog', labels: ['geparkeerd: 2027-02', 'urgency: now', 'prio: high'] }),
    issue({ title: 'december', labels: ['geparkeerd: 2026-12', 'urgency: whenever', 'prio: low'] }),
  ];
  const { parked, free } = takenList(list, opts());
  assert.deepEqual(
    parked.map((r) => [r.issue.title, r.parkedUntil]),
    [
      ['december', '2026-12'],
      ['februari nu hoog', '2027-02'],
      ['februari nu laag', '2027-02'],
      ['februari ooit', '2027-02'],
      ['maart', '2027-03'],
    ],
  );
  assert.equal(free.length, 0);
});

test('a row whose month has started is not Geparkeerd', () => {
  const [row] = takenList([issue({ labels: ['geparkeerd: 2026-11'] })], opts()).free;
  assert.equal(row.parkedUntil, null);
});

test('Geparkeerd follows the Wie, Prio and Soort filters and the search', () => {
  const list = [
    issue({ title: 'zonnepanelen', labels: ['geparkeerd: 2027-02', 'soort: klusjes', 'prio: high'] }),
    issue({ title: 'feest', labels: ['geparkeerd: 2027-02', 'soort: sociaal'], assignees: [person('partner')] }),
  ];
  assert.deepEqual(titles(list, { filters: { ...ALL, soort: ['klusjes'] } }).parked, ['zonnepanelen']);
  assert.deepEqual(titles(list, { filters: { ...ALL, prio: ['middel'] } }).parked, ['feest']);
  assert.deepEqual(titles(list, { filters: { ...ALL, wie: 'mijn' } }).parked, ['zonnepanelen']);
  assert.deepEqual(titles(list, { search: 'feest' }).parked, ['feest']);
});

test('a Taak waiting on a Geparkeerd Taak knows until when that is parked', () => {
  const parked = issue({ title: 'zonnepanelen', labels: ['geparkeerd: 2027-02'] });
  const free = issue({ title: 'dak', labels: ['geparkeerd: 2026-10'] });
  const taak = issue({ title: 'subsidie', blockedBy: [parked.ref, free.ref] });
  const [row] = takenList([parked, free, taak], opts()).blocked;
  assert.deepEqual(
    row.waitingFor.map((w) => [w.title, w.parkedUntil]),
    [
      ['zonnepanelen', '2027-02'],
      ['dak', null],
    ],
  );
});
