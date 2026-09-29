import { normalise } from './text.js';
import { kindOf, matchesRef, prioOf, urgentieOf, PRIO_LABELS, URGENTIE_LABELS } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {import('./data/model.js').Urgentie} Urgentie */
/** @typedef {'iedereen' | 'mijn' | 'partner'} Wie */
/** An empty Prio or Urgentie list means no filter on it. */
/** @typedef {{ prio: Prio[], urgentie: Urgentie[], wie: Wie }} Filters */
/**
 * One Taak as the list shows it. `breadcrumb` is its Epic and Mijlpaal, where
 * it has them; `waitingFor` the open Taken it is Geblokkeerd by.
 * @typedef {{
 *   issue: Issue,
 *   prio: Prio,
 *   urgentie: Urgentie,
 *   breadcrumb: string[],
 *   waitingFor: { ref: IssueRef, title: string }[],
 * }} Row
 */

/** In display and sort order. */
const PRIOS = /** @type {Prio[]} */ (Object.keys(PRIO_LABELS)).reverse();
const URGENTIES = /** @type {Urgentie[]} */ (Object.keys(URGENTIE_LABELS));
/** @type {Wie[]} */
const WIE = ['iedereen', 'mijn', 'partner'];

/** @type {Filters} */
export const ALL = { prio: [], urgentie: [], wie: 'iedereen' };

const FILTERS_KEY = 'nexus.takenFilters';

/** Whether these filters hide anything. @param {Filters} filters */
export function isFiltered(filters) {
  return filters.prio.length > 0 || filters.urgentie.length > 0 || filters.wie !== ALL.wie;
}

/**
 * The open Taken, filtered and sorted by Urgentie then Prio, with the
 * Geblokkeerd ones apart so they can go at the bottom.
 * @param {Issue[]} issues
 * @param {{ filters: Filters, search: string, me: string }} options `me` is the signed-in login.
 * @returns {{ free: Row[], blocked: Row[] }}
 */
export function takenList(issues, { filters, search, me }) {
  const open = issues.filter((i) => i.state === 'open');
  const terms = normalise(search).split(/\s+/).filter(Boolean);
  const rows = open
    .filter((i) => kindOf(i) === 'taak')
    .map((issue) => toRow(issue, issues, open))
    .filter((row) => matchesFilters(row, filters, me.toLowerCase()))
    .filter((row) => matchesSearch(row.issue, terms))
    .sort(byUrgentieThenPrio);
  return {
    free: rows.filter((r) => r.waitingFor.length === 0),
    blocked: rows.filter((r) => r.waitingFor.length > 0),
  };
}

/** @param {Issue} issue @param {Issue[]} issues @param {Issue[]} open @returns {Row} */
function toRow(issue, issues, open) {
  const epic = issue.parent === null ? undefined : issues.find((i) => i.number === issue.parent);
  return {
    issue,
    prio: prioOf(issue),
    urgentie: urgentieOf(issue),
    breadcrumb: [epic?.title, issue.milestone?.title].filter((t) => !!t).map(String),
    // A blocker that is closed, or not in Nexus, no longer holds the Taak up.
    waitingFor: issue.blockedBy.flatMap((ref) => {
      const blocker = open.find((i) => matchesRef(i, ref));
      return blocker ? [{ ref: blocker.ref, title: blocker.title }] : [];
    }),
  };
}

/**
 * "Mijn" and "Partner" are what that person could pick up: Taken Toegewezen
 * to them, plus unassigned ones. The partner is anyone who isn't me.
 * @param {Row} row @param {Filters} filters @param {string} me lowercased login
 */
function matchesFilters(row, filters, me) {
  if (filters.prio.length > 0 && !filters.prio.includes(row.prio)) return false;
  if (filters.urgentie.length > 0 && !filters.urgentie.includes(row.urgentie)) return false;
  const logins = row.issue.assignees.map((a) => a.login.toLowerCase());
  if (logins.length === 0 || filters.wie === 'iedereen') return true;
  return filters.wie === 'mijn' ? logins.includes(me) : logins.some((l) => l !== me);
}

/** Every search term must be in the title or description. @param {Issue} issue @param {string[]} terms */
function matchesSearch(issue, terms) {
  if (terms.length === 0) return true;
  const text = normalise(`${issue.title}\n${issue.body}`);
  return terms.every((t) => text.includes(t));
}

/** @param {Row} a @param {Row} b */
function byUrgentieThenPrio(a, b) {
  return (
    URGENTIES.indexOf(a.urgentie) - URGENTIES.indexOf(b.urgentie) ||
    PRIOS.indexOf(a.prio) - PRIOS.indexOf(b.prio) ||
    a.issue.createdAt.localeCompare(b.issue.createdAt)
  );
}

/**
 * The filters last used on this device. Anything unreadable, or values an
 * older version stored, falls back to no filter.
 * @param {Storage} storage
 * @returns {Filters}
 */
export function loadFilters(storage) {
  let saved;
  try {
    saved = JSON.parse(storage.getItem(FILTERS_KEY) ?? 'null');
  } catch {
    return ALL;
  }
  if (!saved || typeof saved !== 'object') return ALL;
  return {
    prio: onlyKnown(saved.prio, PRIOS),
    urgentie: onlyKnown(saved.urgentie, URGENTIES),
    wie: WIE.includes(saved.wie) ? saved.wie : ALL.wie,
  };
}

/** @param {Storage} storage @param {Filters} filters */
export function saveFilters(storage, filters) {
  try {
    storage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Not remembered; the filters still apply until the app closes.
  }
}

/**
 * @template {string} V
 * @param {unknown} value
 * @param {V[]} known
 * @returns {V[]}
 */
function onlyKnown(value, known) {
  return Array.isArray(value) ? known.filter((k) => value.includes(k)) : [];
}
