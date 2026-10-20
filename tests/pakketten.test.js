import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pakketDetails, pakkettenList, dutchDate, mapsUrl, localDate } from '../src/pakketten.js';
import { toIssue } from '../src/data/model.js';

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
