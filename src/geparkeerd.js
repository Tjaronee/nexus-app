/**
 * Geparkeerd: a Taak kept out of sight until a month, by a label
 * `geparkeerd: YYYY-MM` (Nexus ADR 0006). From the first of that month it is
 * an ordinary Taak again; the label stays, and tells when it became relevant.
 */

/** @typedef {import('./data/model.js').Issue} Issue */
/** A month as `YYYY-MM`, as in the label. @typedef {string} Month */
/**
 * Per Taak, the days (`YYYY-MM-DD`) it was seen on this phone since its
 * month started. Keyed by the Taak's ref.
 * @typedef {Record<string, { month: Month, days: string[] }>} Seen
 */

export const GEPARKEERD_PREFIX = 'geparkeerd: ';

const SEEN_KEY = 'nexus.geparkeerdGezien';
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const NAMES = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
/** How many days a Taak must be seen before it stops standing out. */
const DAYS_TO_STAND_OUT = 3;
/** A Taak only stands out this many months after its month started, so a new phone doesn't colour every Taak ever parked. */
const MONTHS_TO_STAND_OUT = 2;

/** The month a date is in, on the phone's clock. @param {Date} date @returns {Month} */
export function monthOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The month in a Taak's `geparkeerd:` label, or null. A Taak has at most one,
 * but two can be set by hand on github.com; then the latest counts.
 * @param {Issue} issue
 * @returns {Month | null}
 */
export function parkedMonthOf(issue) {
  const months = issue.labels
    .filter((l) => l.startsWith(GEPARKEERD_PREFIX))
    .map((l) => l.slice(GEPARKEERD_PREFIX.length).trim())
    .filter((m) => MONTH.test(m))
    .sort();
  return months.at(-1) ?? null;
}

/** Whether the Taak is Geparkeerd: its month is still to come. @param {Issue} issue @param {Date} today */
export function isParked(issue, today) {
  return parkedUntil(issue, today) !== null;
}

/**
 * The month the Taak is Geparkeerd until, or null when it isn't. A month that
 * has started leaves the label, but the Taak is no longer parked.
 * @param {Issue} issue @param {Date} today
 * @returns {Month | null}
 */
export function parkedUntil(issue, today) {
  const month = parkedMonthOf(issue);
  return month !== null && month > monthOf(today) ? month : null;
}

/**
 * What a Taak can be parked until: the next 12 months, next month first.
 * @param {Date} today
 * @returns {{ month: Month, name: string }[]}
 */
export function monthChoices(today) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = monthOf(new Date(today.getFullYear(), today.getMonth() + 1 + i, 1));
    return { month, name: monthName(month, today) };
  });
}

/**
 * A month in Dutch, as in "tot februari". Without the year: a month to come
 * is the next one with that name, also this month's name, which can only mean
 * next year's. Only a month further ahead (set by hand), or a year or more
 * ago, needs its year.
 * @param {Month} month @param {Date} today
 */
export function monthName(month, today) {
  const name = NAMES[Number(month.slice(5)) - 1];
  const ahead = monthsBetween(monthOf(today), month);
  return ahead > 12 || ahead <= -12 ? `${name} ${month.slice(0, 4)}` : name;
}

/**
 * The labels to add and remove so a Taak is parked until `chosen`, or not
 * parked at all for null. Every other `geparkeerd:` label goes.
 * @param {string[]} labels the Taak's labels now
 * @param {Month | null} chosen
 * @returns {{ add: string[], remove: string[] }}
 */
export function parkChange(labels, chosen) {
  const label = chosen === null ? null : GEPARKEERD_PREFIX + chosen;
  return {
    add: label === null || labels.includes(label) ? [] : [label],
    remove: labels.filter((l) => l.startsWith(GEPARKEERD_PREFIX) && l !== label),
  };
}

/**
 * Whether a Taak stands out as just become relevant: its month started less
 * than two months ago, and it hasn't yet been seen on 3 days on this phone
 * since. Days seen for an earlier month don't count.
 * @param {Issue} issue @param {Date} today @param {Seen} seen
 */
export function standsOut(issue, today, seen) {
  const month = startedMonth(issue, today);
  if (month === null) return false;
  const entry = seen[String(issue.ref)];
  return (entry?.month === month ? entry.days.length : 0) < DAYS_TO_STAND_OUT;
}

/**
 * `seen` with today added for each of these Taken that stands out, as they
 * were visibly on screen. Entries for Taken that can no longer stand out go.
 * @param {Seen} seen @param {Issue[]} issues @param {Date} today
 * @returns {Seen}
 */
export function markSeen(seen, issues, today) {
  const date = `${monthOf(today)}-${String(today.getDate()).padStart(2, '0')}`;
  /** @type {Seen} */
  const next = {};
  for (const [ref, entry] of Object.entries(seen)) {
    const age = monthsBetween(entry.month, monthOf(today));
    if (age >= 0 && age < MONTHS_TO_STAND_OUT) next[ref] = entry;
  }
  for (const issue of issues) {
    const month = startedMonth(issue, today);
    if (month === null) continue;
    const key = String(issue.ref);
    const days = next[key]?.month === month ? next[key].days : [];
    if (!days.includes(date) && days.length < DAYS_TO_STAND_OUT) next[key] = { month, days: [...days, date] };
  }
  return next;
}

/**
 * The days seen, as kept on this phone. Anything unreadable counts as never
 * seen, so the Taak just stands out again.
 * @param {Storage} storage
 * @returns {Seen}
 */
export function loadSeen(storage) {
  let saved;
  try {
    saved = JSON.parse(storage.getItem(SEEN_KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!saved || typeof saved !== 'object') return {};
  /** @type {Seen} */
  const seen = {};
  for (const [ref, entry] of Object.entries(saved)) {
    if (typeof entry?.month === 'string' && MONTH.test(entry.month) && Array.isArray(entry.days)) {
      seen[ref] = { month: entry.month, days: entry.days.filter((/** @type {unknown} */ d) => typeof d === 'string') };
    }
  }
  return seen;
}

/** @param {Storage} storage @param {Seen} seen */
export function saveSeen(storage, seen) {
  try {
    storage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Not remembered; the Taak stands out a little longer.
  }
}

/** The Taak's month, if it started recently enough to stand out. @param {Issue} issue @param {Date} today */
function startedMonth(issue, today) {
  const month = parkedMonthOf(issue);
  if (month === null) return null;
  const age = monthsBetween(month, monthOf(today));
  return age >= 0 && age < MONTHS_TO_STAND_OUT ? month : null;
}

/** How many months `to` is after `from`. @param {Month} from @param {Month} to */
function monthsBetween(from, to) {
  const index = (/** @type {Month} */ m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
  return index(to) - index(from);
}
