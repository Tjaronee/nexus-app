import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedLocaties, matchLocatie, locatieChange, locatieKey } from '../src/locaties.js';
import { mapsUrl } from '../src/pakketten.js';

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

test('a Locatie name is written like a Plek: one space, lowercase', () => {
  assert.equal(locatieKey('  PostNL-punt   Jumbo '), 'postnl-punt jumbo');
});

test('Thuis comes first, even without its label, then the saved Locaties alphabetically', () => {
  const locaties = savedLocaties(['locatie: werk', 'prio: high', 'locatie: buren', 'waar: praxis'], {});
  assert.deepEqual(
    locaties.map((l) => [l.locatie, l.labels]),
    [['Thuis', []], ['Buren', ['locatie: buren']], ['Werk', ['locatie: werk']]],
  );
});

test('each Locatie carries its address from the label description', () => {
  const locaties = savedLocaties(['locatie: thuis', 'locatie: buren'], {
    'locatie: thuis': 'Dorpsstraat 1, Utrecht',
    'prio: high': 'Belangrijk',
  });
  assert.deepEqual(
    locaties.map((l) => [l.locatie, l.adres]),
    [['Thuis', 'Dorpsstraat 1, Utrecht'], ['Buren', '']],
  );
});

test('a label written by hand is listed normalised, once', () => {
  const locaties = savedLocaties(['locatie: Buren', 'locatie:  buren', 'locatie: '], { 'locatie:  buren': 'Dorpsstraat 3' });
  assert.deepEqual(
    locaties.map((l) => [l.locatie, l.labels, l.adres]),
    [['Thuis', [], ''], ['Buren', ['locatie: Buren', 'locatie:  buren'], 'Dorpsstraat 3']],
  );
});

test('a Locatie matches a saved one compared normalised', () => {
  const locaties = savedLocaties(['locatie: postnl-punt jumbo'], {});
  assert.equal(matchLocatie('PostNL-punt  Jumbo', locaties)?.locatie, 'Postnl-punt jumbo');
  assert.equal(matchLocatie(' thuis ', locaties)?.locatie, 'Thuis');
  assert.equal(matchLocatie('Jumbo', locaties), null);
});

test('the Maps link goes to the saved address when the name matches, else to the text', () => {
  const locaties = savedLocaties(['locatie: buren', 'locatie: werk'], { 'locatie: buren': 'Dorpsstraat 3, Utrecht' });
  assert.equal(mapsUrl('Buren', locaties), `${MAPS}Dorpsstraat%203%2C%20Utrecht`);
  assert.equal(mapsUrl(' BUREN ', locaties), `${MAPS}Dorpsstraat%203%2C%20Utrecht`);
  assert.equal(mapsUrl('Werk', locaties), `${MAPS}Werk`);
  assert.equal(mapsUrl('Jumbo Kerkstraat', locaties), `${MAPS}Jumbo%20Kerkstraat`);
});

test('Thuis has no Maps link, unless it has an address', () => {
  assert.equal(mapsUrl('Thuis', savedLocaties([], {})), null);
  assert.equal(mapsUrl('Thuis', savedLocaties(['locatie: thuis'], {})), null);
  const metAdres = savedLocaties(['locatie: thuis'], { 'locatie: thuis': 'Dorpsstraat 1' });
  assert.equal(mapsUrl('thuis', metAdres), `${MAPS}Dorpsstraat%201`);
});

// Adding and editing

const locaties = savedLocaties(['locatie: buren', 'locatie: werk'], { 'locatie: werk': 'Stationsplein 1' });
const [thuis, buren, werk] = locaties;

test('+ Locatie creates the normalised label with the address as its description', () => {
  assert.deepEqual(locatieChange(null, { naam: ' PostNL-punt  Jumbo ', adres: ' Kerkstraat 2,  Utrecht ' }, locaties), {
    create: { name: 'locatie: postnl-punt jumbo', description: 'Kerkstraat 2, Utrecht' },
  });
  assert.deepEqual(locatieChange(null, { naam: 'Oma', adres: '' }, locaties), { create: { name: 'locatie: oma', description: '' } });
});

test('a new Locatie needs a name that is not already saved, Thuis included', () => {
  assert.deepEqual(locatieChange(null, { naam: '  ', adres: '' }, locaties), { problem: 'naam' });
  assert.deepEqual(locatieChange(null, { naam: 'BUREN', adres: '' }, locaties), { problem: 'bestaat', locatie: 'Buren' });
  assert.deepEqual(locatieChange(null, { naam: 'thuis', adres: '' }, locaties), { problem: 'bestaat', locatie: 'Thuis' });
});

test('an address is at most 100 characters', () => {
  assert.deepEqual(locatieChange(null, { naam: 'Oma', adres: 'x'.repeat(101) }, locaties), { problem: 'adres' });
  assert.ok('create' in (locatieChange(null, { naam: 'Oma', adres: 'x'.repeat(100) }, locaties) ?? {}));
});

test('editing renames the label and changes its description, sending only what changed', () => {
  assert.deepEqual(locatieChange(werk, { naam: 'Kantoor', adres: 'Stationsplein 1' }, locaties), {
    edit: { label: 'locatie: werk', name: 'locatie: kantoor' },
  });
  assert.deepEqual(locatieChange(werk, { naam: 'werk ', adres: '' }, locaties), {
    edit: { label: 'locatie: werk', description: '' },
  });
  assert.deepEqual(locatieChange(buren, { naam: 'Buren', adres: 'Dorpsstraat 3' }, locaties), {
    edit: { label: 'locatie: buren', description: 'Dorpsstraat 3' },
  });
  assert.equal(locatieChange(werk, { naam: 'Werk', adres: 'Stationsplein 1' }, locaties), null);
});

test('a Locatie cannot be renamed to another saved one', () => {
  assert.deepEqual(locatieChange(werk, { naam: 'buren', adres: '' }, locaties), { problem: 'bestaat', locatie: 'Buren' });
  assert.deepEqual(locatieChange(werk, { naam: 'Thuis', adres: '' }, locaties), { problem: 'bestaat', locatie: 'Thuis' });
  assert.deepEqual(locatieChange(werk, { naam: '', adres: '' }, locaties), { problem: 'naam' });
});

test('Thuis can get an address, creating its label the first time, but keeps its name', () => {
  assert.deepEqual(locatieChange(thuis, { naam: 'Huis', adres: 'Dorpsstraat 1' }, locaties), {
    create: { name: 'locatie: thuis', description: 'Dorpsstraat 1' },
  });
  assert.equal(locatieChange(thuis, { naam: '', adres: '' }, locaties), null);
  const saved = savedLocaties(['locatie: thuis'], { 'locatie: thuis': 'Dorpsstraat 1' })[0];
  assert.deepEqual(locatieChange(saved, { naam: 'Huis', adres: '' }, locaties), { edit: { label: 'locatie: thuis', description: '' } });
});
