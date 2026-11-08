import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEPARKEERD_PREFIX,
  monthOf,
  parkedMonthOf,
  isParked,
  parkedUntil,
  monthChoices,
  monthName,
  parkChange,
  standsOut,
  markSeen,
  loadSeen,
  saveSeen,
} from '../src/geparkeerd.js';
import { memoryStorage } from './memory-storage.js';

/** @typedef {import('../src/data/model.js').Issue} Issue */
/** @typedef {import('../src/geparkeerd.js').Seen} Seen */

/** Only what Geparkeerd is read from. @param {string[]} labels @param {number} [ref] */
const withLabels = (labels, ref = 1) =>
  /** @type {Issue} */ (/** @type {unknown} */ ({ ref, labels, state: 'open' }));

/** A local date, as the phone's clock gives it. @param {number} y @param {number} m 1-12 @param {number} d */
const day = (y, m, d) => new Date(y, m - 1, d, 12);

test('the label is `geparkeerd: YYYY-MM`', () => {
  assert.equal(GEPARKEERD_PREFIX, 'geparkeerd: ');
  assert.equal(monthOf(day(2026, 11, 8)), '2026-11');
  assert.equal(monthOf(day(2027, 2, 1)), '2027-02');
  assert.equal(parkedMonthOf(withLabels(['prio: high', 'geparkeerd: 2027-02'])), '2027-02');
  assert.equal(parkedMonthOf(withLabels(['prio: high'])), null);
});

test('a label that is not a month is ignored; of two set by hand, the latest counts', () => {
  assert.equal(parkedMonthOf(withLabels(['geparkeerd: februari', 'geparkeerd: 2027-13', 'geparkeerd: 27-02'])), null);
  assert.equal(parkedMonthOf(withLabels(['geparkeerd: 2027-03', 'geparkeerd: 2027-01'])), '2027-03');
});

test('parked while the month is in the future; from the first of that month an ordinary Taak', () => {
  const taak = withLabels(['geparkeerd: 2027-02']);
  assert.equal(isParked(taak, day(2026, 11, 8)), true);
  assert.equal(isParked(taak, new Date(2027, 0, 31, 23, 59)), true);
  assert.equal(isParked(taak, new Date(2027, 1, 1, 0, 0)), false);
  assert.equal(isParked(taak, day(2027, 6, 1)), false);
  assert.equal(isParked(withLabels([]), day(2026, 11, 8)), false);
  assert.equal(parkedUntil(taak, day(2026, 11, 8)), '2027-02');
  assert.equal(parkedUntil(taak, day(2027, 2, 1)), null);
});

test('the month choices are the next 12 months, starting with next month', () => {
  const choices = monthChoices(day(2026, 11, 8));
  assert.equal(choices.length, 12);
  assert.deepEqual(choices[0], { month: '2026-12', name: 'december' });
  assert.deepEqual(choices[1], { month: '2027-01', name: 'januari' });
  // The choice always means the next one, so even this month's name needs no year.
  assert.deepEqual(choices[11], { month: '2027-11', name: 'november' });
  assert.deepEqual(
    choices.slice(1, 11).map((c) => c.name),
    ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober'],
  );
});

test('in December the choices run from januari to december', () => {
  const choices = monthChoices(day(2026, 12, 31));
  assert.deepEqual(choices[0], { month: '2027-01', name: 'januari' });
  assert.deepEqual(choices[11], { month: '2027-12', name: 'december' });
});

test('a month is named in Dutch, with its year only when that would be unclear', () => {
  const today = day(2026, 11, 8);
  assert.equal(monthName('2027-02', today), 'februari');
  assert.equal(monthName('2026-09', today), 'september');
  assert.equal(monthName('2027-11', today), 'november');
  assert.equal(monthName('2028-03', today), 'maart 2028');
  assert.equal(monthName('2025-11', today), 'november 2025');
});

test('choosing a month replaces any geparkeerd: label; Niet geparkeerd removes it', () => {
  assert.deepEqual(parkChange(['prio: high'], '2027-02'), { add: ['geparkeerd: 2027-02'], remove: [] });
  assert.deepEqual(parkChange(['geparkeerd: 2026-03', 'geparkeerd: 2027-01'], '2027-02'), {
    add: ['geparkeerd: 2027-02'],
    remove: ['geparkeerd: 2026-03', 'geparkeerd: 2027-01'],
  });
  assert.deepEqual(parkChange(['geparkeerd: 2027-02'], '2027-02'), { add: [], remove: [] });
  assert.deepEqual(parkChange(['geparkeerd: 2027-02', 'prio: high'], null), { add: [], remove: ['geparkeerd: 2027-02'] });
  assert.deepEqual(parkChange([], null), { add: [], remove: [] });
});

test('a Taak stands out once its month has started, only within two months of that', () => {
  const taak = withLabels(['geparkeerd: 2027-02']);
  assert.equal(standsOut(taak, day(2027, 1, 31), {}), false, 'still parked');
  assert.equal(standsOut(taak, day(2027, 2, 1), {}), true);
  assert.equal(standsOut(taak, day(2027, 3, 31), {}), true);
  assert.equal(standsOut(taak, day(2027, 4, 1), {}), false, 'two months after it started');
  assert.equal(standsOut(withLabels([]), day(2027, 2, 1), {}), false);
});

test('it stops standing out after being seen on 3 different days', () => {
  const taak = withLabels(['geparkeerd: 2027-02'], 7);
  let seen = markSeen({}, [taak], day(2027, 2, 1));
  seen = markSeen(seen, [taak], new Date(2027, 1, 1, 20));
  assert.equal(standsOut(taak, day(2027, 2, 2), seen), true, 'twice on one day is one day');
  seen = markSeen(seen, [taak], day(2027, 2, 3));
  assert.equal(standsOut(taak, day(2027, 2, 3), seen), true);
  seen = markSeen(seen, [taak], day(2027, 2, 10));
  assert.equal(standsOut(taak, day(2027, 2, 10), seen), false);
  assert.equal(standsOut(withLabels(['geparkeerd: 2027-02'], 8), day(2027, 2, 10), seen), true, 'counted per Taak');
});

test('parking it again starts over: days seen for an earlier month do not count', () => {
  /** @type {Seen} */
  let seen = {};
  const first = withLabels(['geparkeerd: 2027-02'], 7);
  for (const d of [1, 2, 3]) seen = markSeen(seen, [first], day(2027, 2, d));
  const again = withLabels(['geparkeerd: 2027-03'], 7);
  assert.equal(standsOut(again, day(2027, 3, 1), seen), true);
});

test('seeing a Taak that does not stand out records nothing, and old entries are dropped', () => {
  const plain = withLabels([], 1);
  const parked = withLabels(['geparkeerd: 2027-06'], 2);
  assert.deepEqual(markSeen({}, [plain, parked], day(2027, 2, 1)), {});

  const old = markSeen({}, [withLabels(['geparkeerd: 2027-02'], 3)], day(2027, 2, 1));
  assert.deepEqual(markSeen(old, [], day(2027, 4, 1)), {});
});

test('the days seen are kept on the phone; unreadable storage just means it stands out again', () => {
  const storage = memoryStorage();
  const taak = withLabels(['geparkeerd: 2027-02'], 7);
  assert.deepEqual(loadSeen(storage), {});
  let seen = loadSeen(storage);
  for (const d of [1, 2, 3]) seen = markSeen(seen, [taak], day(2027, 2, d));
  saveSeen(storage, seen);
  assert.equal(standsOut(taak, day(2027, 2, 4), loadSeen(storage)), false);

  storage.setItem('nexus.geparkeerdGezien', '{not json');
  assert.deepEqual(loadSeen(storage), {});
  storage.setItem('nexus.geparkeerdGezien', JSON.stringify({ 7: { month: '2027-02', days: 'nope' }, 8: null }));
  assert.equal(standsOut(taak, day(2027, 2, 4), loadSeen(storage)), true);

  const broken = /** @type {Storage} */ (/** @type {unknown} */ ({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  }));
  assert.deepEqual(loadSeen(broken), {});
  assert.doesNotThrow(() => saveSeen(broken, seen));
});
