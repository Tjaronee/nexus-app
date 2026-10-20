import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pakketDetails, pakkettenList, dutchDate, mapsUrl, localDate,
  pakketBody, normaliseLocatie, pakketProblem, pakketDraft, newPakketDraft, savePakket,
} from '../src/pakketten.js';
import { toIssue, matchesRef } from '../src/data/model.js';
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
    title: `Pakket ${number}`,
    body: '',
    state: 'open',
    stateReason: null,
    labels: ['pakket'],
    assignees: [],
    milestone: null,
    blockedByCount: 0,
    blockedBy: [],
    comments: 0,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    closedAt: null,
    ...over,
  };
}

/**
 * @param {string} title
 * @param {{ verwacht?: string, locatie?: string, tracker?: string }} [details]
 * @param {Partial<Issue>} [over]
 */
function pakket(title, { verwacht, locatie, tracker } = {}, over = {}) {
  const lines = [];
  if (tracker !== undefined) lines.push(`Tracker: ${tracker}`);
  if (verwacht !== undefined) lines.push(`Verwacht: ${verwacht}`);
  if (locatie !== undefined) lines.push(`Locatie: ${locatie}`);
  return issue({ title, body: lines.join('\n'), ...over });
}

const TODAY = '2026-10-20';

/** @param {Issue[]} issues */
const titles = (issues) => pakkettenList(issues, TODAY).map((item) => item.issue.title);

test('reads Tracker, Verwacht and Locatie from the body', () => {
  const body = 'Tracker: https://jouw.postnl.nl/track-and-trace/3S123\nVerwacht: 2026-10-23\nLocatie: PostNL-punt Jumbo Kerkstraat';
  assert.deepEqual(pakketDetails(body), {
    tracker: 'https://jouw.postnl.nl/track-and-trace/3S123',
    verwacht: '2026-10-23',
    locatie: 'PostNL-punt Jumbo Kerkstraat',
  });
});

test('every line is optional', () => {
  assert.deepEqual(pakketDetails(''), { tracker: null, verwacht: null, locatie: null });
  assert.deepEqual(pakketDetails('Locatie: Thuis'), { tracker: null, verwacht: null, locatie: 'Thuis' });
  assert.deepEqual(pakketDetails('Verwacht: 2026-10-23'), { tracker: null, verwacht: '2026-10-23', locatie: null });
});

test('keys ignore case and the spaces around them; other text is ignored', () => {
  const body = 'Besteld bij de webshop.\n\n  tracker :  https://dhl.nl/t/1  \nVERWACHT:2026-10-23\r\n locatie: Buren \nOpmerking: bel aan';
  assert.deepEqual(pakketDetails(body), { tracker: 'https://dhl.nl/t/1', verwacht: '2026-10-23', locatie: 'Buren' });
});

test('an unparseable date counts as no date', () => {
  for (const date of ['23 oktober', '2026-13-01', '2026-02-30', '2026-10-2', 'morgen', '']) {
    assert.equal(pakketDetails(`Verwacht: ${date}`).verwacht, null, date);
  }
});

test('an empty Locatie is no Locatie, and a tracker must be a web link', () => {
  assert.equal(pakketDetails('Locatie:   ').locatie, null);
  assert.equal(pakketDetails('Tracker: javascript:alert(1)').tracker, null);
  assert.equal(pakketDetails('Tracker: 3S123456').tracker, null);
  assert.equal(pakketDetails('Tracker: http://track.example/1').tracker, 'http://track.example/1');
});

test('the hidden cid marker is ignored', () => {
  const raw = {
    number: 9,
    title: 'Stofzuiger',
    body: 'Verwacht: 2026-10-23\nLocatie: Thuis\n\n<!-- cid:abc-123 -->',
    state: 'open',
    labels: [{ name: 'pakket' }],
  };
  assert.deepEqual(pakketDetails(toIssue(raw).body), { tracker: null, verwacht: '2026-10-23', locatie: 'Thuis' });
});

test('lists the open Pakketten only: no closed ones, Taken or Boodschappen', () => {
  const issues = [
    pakket('Stofzuiger'),
    pakket('Boek', {}, { state: 'closed', stateReason: 'completed' }),
    pakket('Lamp', {}, { state: 'closed', stateReason: 'not_planned' }),
    issue({ title: 'Meubels opmeten', labels: [] }),
    issue({ title: 'melk', labels: ['boodschappen'] }),
  ];
  assert.deepEqual(titles(issues), ['Stofzuiger']);
});

test('sorts by Verwachte datum, soonest first, undated last', () => {
  const issues = [
    pakket('Geen datum'),
    pakket('Later', { verwacht: '2026-10-30' }),
    pakket('Te laat', { verwacht: '2026-10-18' }),
    pakket('Kapotte datum', { verwacht: 'gisteren' }),
    pakket('Eerder', { verwacht: '2026-10-21' }),
  ];
  assert.deepEqual(titles(issues), ['Te laat', 'Eerder', 'Later', 'Geen datum', 'Kapotte datum']);
});

test('on one date: Thuis first, then the Locaties alphabetically, then by title', () => {
  const day = '2026-10-23';
  const issues = [
    pakket('Boek', { verwacht: day, locatie: 'PostNL-punt Jumbo' }),
    pakket('Zeep', { verwacht: day, locatie: 'thuis' }),
    pakket('Lamp', { verwacht: day, locatie: 'Buren' }),
    pakket('Appel', { verwacht: day, locatie: 'Thuis' }),
    pakket('Onbekend', { verwacht: day }),
    pakket('Accu', { verwacht: day, locatie: 'PostNL-punt Jumbo' }),
  ];
  assert.deepEqual(titles(issues), ['Appel', 'Zeep', 'Lamp', 'Accu', 'Boek', 'Onbekend']);
});

test('a date before today is overdue; today and later are not', () => {
  const issues = [
    pakket('Gisteren', { verwacht: '2026-10-19' }),
    pakket('Vandaag', { verwacht: '2026-10-20' }),
    pakket('Morgen', { verwacht: '2026-10-21' }),
    pakket('Geen datum'),
  ];
  assert.deepEqual(
    pakkettenList(issues, TODAY).map((item) => [item.issue.title, item.overdue]),
    [['Gisteren', true], ['Vandaag', false], ['Morgen', false], ['Geen datum', false]],
  );
});

test('an item carries its details', () => {
  const [item] = pakkettenList([pakket('Stofzuiger', { tracker: 'https://t.nl/1', verwacht: '2026-10-23', locatie: 'Buren' })], TODAY);
  assert.equal(item.tracker, 'https://t.nl/1');
  assert.equal(item.verwacht, '2026-10-23');
  assert.equal(item.locatie, 'Buren');
});

test('dates are written the Dutch short way', () => {
  assert.equal(dutchDate('2026-10-23'), 'vr 23 okt');
  assert.equal(dutchDate('2026-10-22'), 'do 22 okt');
  assert.equal(dutchDate('2026-03-01'), 'zo 1 mrt');
  assert.equal(dutchDate('2027-01-04'), 'ma 4 jan');
});

test('today is the local calendar date', () => {
  assert.equal(localDate(new Date(2026, 9, 20, 23, 59)), '2026-10-20');
  assert.equal(localDate(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

test('a Locatie links to Google Maps, except Thuis', () => {
  assert.equal(
    mapsUrl('PostNL-punt Jumbo Kerkstraat'),
    'https://www.google.com/maps/search/?api=1&query=PostNL-punt%20Jumbo%20Kerkstraat',
  );
  assert.equal(mapsUrl('Café & co'), 'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20co');
  assert.equal(mapsUrl('Thuis'), null);
  assert.equal(mapsUrl(' thuis '), null);
});

// Writing a Pakket

const TRACKER = 'https://jouw.postnl.nl/track-and-trace/3S123';

test('a new Pakket gets its lines in order: Tracker, Verwacht, Locatie', () => {
  assert.equal(
    pakketBody('', { tracker: TRACKER, verwacht: '2026-10-23', locatie: 'Thuis' }),
    `Tracker: ${TRACKER}\nVerwacht: 2026-10-23\nLocatie: Thuis`,
  );
  assert.equal(pakketBody('', { tracker: null, verwacht: null, locatie: 'Buren' }), 'Locatie: Buren');
});

test('editing keeps the other text where it was, and the lines where the first one was', () => {
  const body = 'Besteld bij de webshop.\n\nlocatie: Buren\nTracker: https://dhl.nl/t/1\n\nOpmerking: bel aan\nNog een regel.';
  assert.equal(
    pakketBody(body, { tracker: TRACKER, verwacht: '2026-10-23', locatie: 'Thuis' }),
    `Besteld bij de webshop.\n\nTracker: ${TRACKER}\nVerwacht: 2026-10-23\nLocatie: Thuis\n\nOpmerking: bel aan\nNog een regel.`,
  );
});

test('text without any of the lines stays first, the lines go under it', () => {
  assert.equal(pakketBody('Twee dozen.', { tracker: null, verwacht: null, locatie: 'Thuis' }), 'Twee dozen.\n\nLocatie: Thuis');
});

test('a cleared date or tracker removes its line', () => {
  const body = `Tracker: ${TRACKER}\nVerwacht: 2026-10-23\nLocatie: Thuis\n\nVoor de verjaardag.`;
  assert.equal(
    pakketBody(body, { tracker: TRACKER, verwacht: null, locatie: 'Thuis' }),
    `Tracker: ${TRACKER}\nLocatie: Thuis\n\nVoor de verjaardag.`,
  );
  assert.equal(
    pakketBody(body, { tracker: null, verwacht: '2026-10-23', locatie: 'Thuis' }),
    'Verwacht: 2026-10-23\nLocatie: Thuis\n\nVoor de verjaardag.',
  );
});

test('a second line with a known key, written by hand, goes too', () => {
  assert.equal(pakketBody('Locatie: Buren\nLOCATIE: werk', { tracker: null, verwacht: null, locatie: 'Thuis' }), 'Locatie: Thuis');
});

test('what is written reads back the same', () => {
  const details = { tracker: TRACKER, verwacht: '2026-10-23', locatie: 'PostNL-punt Jumbo Kerkstraat' };
  const body = pakketBody('Besteld op 18 okt.\nOpmerking: bel aan', details);
  assert.deepEqual(pakketDetails(body), details);
  assert.deepEqual(pakketDetails(pakketBody(body, { ...details, tracker: null })), { ...details, tracker: null });
});

test('a Locatie of "thuis" in any casing is Thuis; others are tidied up', () => {
  for (const typed of ['thuis', ' THUIS ', 'Thuis', 'tHuIs']) assert.equal(normaliseLocatie(typed), 'Thuis', typed);
  assert.equal(normaliseLocatie('  PostNL-punt   Jumbo '), 'PostNL-punt Jumbo');
  assert.equal(normaliseLocatie('   '), '');
});

/** @param {Partial<import('../src/pakketten.js').Draft>} [over] */
const draft = (over = {}) => ({ wat: 'Stofzuiger', tracker: '', verwacht: '', locatie: 'Thuis', ...over });

test('a Pakket needs a Wat and a Locatie, and a tracker must be a web link', () => {
  assert.equal(pakketProblem(draft()), null);
  assert.equal(pakketProblem(draft({ wat: '  ' })), 'wat');
  assert.equal(pakketProblem(draft({ locatie: '  ' })), 'locatie');
  assert.equal(pakketProblem(draft({ tracker: '3S123' })), 'tracker');
  assert.equal(pakketProblem(draft({ tracker: ` ${TRACKER} ` })), null);
});

test('the sheet is filled in from a Pakket', () => {
  const pk = pakket('Stofzuiger', { tracker: TRACKER, verwacht: '2026-10-23', locatie: 'Buren' });
  assert.deepEqual(pakketDraft(pk), { wat: 'Stofzuiger', tracker: TRACKER, verwacht: '2026-10-23', locatie: 'Buren' });
  assert.deepEqual(pakketDraft(pakket('Lamp')), { wat: 'Lamp', tracker: '', verwacht: '', locatie: '' });
});

test('a new sheet is empty, at Thuis; from a Boodschap, Wat is its name', () => {
  assert.deepEqual(newPakketDraft(), { wat: '', tracker: '', verwacht: '', locatie: 'Thuis' });
  assert.deepEqual(newPakketDraft('Stofzuigerzakken'), { wat: 'Stofzuigerzakken', tracker: '', verwacht: '', locatie: 'Thuis' });
});

// Saving through the store

function setup() {
  const server = createFakeGitHub();
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  let n = 0;
  const store = createStore({ github, storage: memoryStorage(), newId: () => `cid-${++n}` });
  return { server, store };
}

/** @param {ReturnType<typeof createStore>} store @param {import('../src/data/model.js').IssueRef} ref */
const find = (store, ref) => store.getState().issues.find((i) => matchesRef(i, ref));

test('a new Pakket is a pakket issue, listed at once, also offline', async () => {
  const { server, store } = setup();
  await store.refresh();
  server.state.offline = true;

  const saved = savePakket(store, null, draft({ wat: ' Stofzuiger ', tracker: TRACKER, verwacht: '2026-10-23', locatie: 'thuis' }));

  assert.ok('ref' in saved);
  assert.deepEqual(titles(store.getState().issues), ['Stofzuiger'], 'listed before GitHub has it');
  await store.flush();
  assert.equal(store.getState().pending, 1);
  server.state.offline = false;
  await store.flush();
  await store.refresh();

  assert.equal(server.issues.length, 1);
  assert.deepEqual(server.issues[0].labels, [{ name: 'pakket' }]);
  const issue = find(store, saved.ref);
  assert.equal(issue?.title, 'Stofzuiger');
  assert.equal(issue?.body, `Tracker: ${TRACKER}\nVerwacht: 2026-10-23\nLocatie: Thuis`);
  assert.equal(typeof issue?.number, 'number');
});

test('a Pakket without Wat or Locatie is not saved', async () => {
  const { store } = setup();
  await store.refresh();

  assert.deepEqual(savePakket(store, null, draft({ wat: ' ' })), { problem: 'wat' });
  assert.deepEqual(savePakket(store, null, draft({ locatie: '' })), { problem: 'locatie' });
  assert.equal(store.getState().pending, 0);
});

test('editing sends only what changed, and other text in the body survives', async () => {
  const { server, store } = setup();
  const raw = server.addIssue({
    title: 'Stofzuiger',
    body: `Besteld bij de webshop.\n\nTracker: ${TRACKER}\nVerwacht: 2026-10-23\nLocatie: Thuis`,
    labels: [{ name: 'pakket' }],
  });
  await store.refresh();
  const ref = raw.number;
  const before = server.state.log.length;

  savePakket(store, ref, draft({ wat: 'Stofzuiger', tracker: TRACKER, verwacht: '', locatie: 'PostNL-punt Jumbo' }));
  await store.flush();

  const patches = server.state.log.slice(before).filter((r) => r.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(server.byNumber(ref).title, 'Stofzuiger');
  assert.equal(find(store, ref)?.body, `Besteld bij de webshop.\n\nTracker: ${TRACKER}\nLocatie: PostNL-punt Jumbo`);
});

test('nothing changed, nothing sent; a renamed Pakket keeps a body the app cannot read', async () => {
  const { server, store } = setup();
  const raw = server.addIssue({ title: 'Lamp', body: 'Verwacht: morgen\nLocatie: Buren', labels: [{ name: 'pakket' }] });
  await store.refresh();
  const ref = raw.number;

  savePakket(store, ref, pakketDraft(/** @type {Issue} */ (find(store, ref))));
  assert.equal(store.getState().pending, 0);

  savePakket(store, ref, { ...pakketDraft(/** @type {Issue} */ (find(store, ref))), wat: 'Bureaulamp' });
  await store.flush();
  assert.equal(server.byNumber(ref).title, 'Bureaulamp');
  assert.equal(server.byNumber(ref).body, 'Verwacht: morgen\nLocatie: Buren');
});

test('a Pakket from a ticked Boodschap has its name and no link to it, and unticking leaves it be', async () => {
  const { server, store } = setup();
  const raw = server.addIssue({ title: 'Stofzuigerzakken', body: 'De grote', labels: [{ name: 'boodschappen' }, { name: 'waar: online' }] });
  await store.refresh();
  store.close(raw.number, 'completed');
  const boodschap = /** @type {Issue} */ (find(store, raw.number));

  const saved = savePakket(store, null, newPakketDraft(boodschap.title));
  await store.flush();
  store.reopen(raw.number);
  await store.flush();
  await store.refresh();

  assert.ok('ref' in saved);
  const pk = find(store, saved.ref);
  assert.equal(pk?.title, 'Stofzuigerzakken');
  assert.deepEqual(pk?.labels, ['pakket']);
  assert.equal(pk?.state, 'open');
  assert.equal(pk?.body, 'Locatie: Thuis', 'only the Locatie: no number, note or Plek of the Boodschap');
  assert.equal(server.byNumber(raw.number).state, 'open');
  assert.equal(server.byNumber(raw.number).body, 'De grote');
});
