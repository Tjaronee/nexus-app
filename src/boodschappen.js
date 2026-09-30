import { kindOf, matchesRef } from './data/model.js';
import { normalise } from './text.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** A Plek name, or null for "Geen plek". @typedef {string | null} PlekKey */
/** `double`: another open Boodschap has the same name ("mogelijk dubbel"). @typedef {{ issue: Issue, note: string, double: boolean }} Item */
/** Zoomed in on one Plek, or null for all of them. @typedef {{ plek: PlekKey } | null} Zoom */

export const PLEK_PREFIX = 'waar: ';
const PLEK_MAX = 50 - PLEK_PREFIX.length;

/**
 * The Boodschappen tab: the open Boodschappen grouped by Plek, and a chip per
 * Plek to zoom in on it. A chip only exists for a Plek with something open,
 * except the one zoomed in on, so it can still be tapped to zoom out.
 *
 * In het mandje is what was bought since `mandjeSince`, a time on this phone's
 * clock. GitHub's clock can differ, so what was ticked on this phone
 * (`tickedHere`) is in it regardless.
 * @param {Issue[]} issues
 * @param {{ zoom: Zoom, mandjeSince: string, tickedHere?: IssueRef[] }} options
 */
export function boodschappenList(issues, { zoom, mandjeSince, tickedHere = [] }) {
  const all = issues.filter((i) => kindOf(i) === 'boodschap');
  const openIssues = all.filter((i) => i.state === 'open');
  // Two open with one name were added at nearly the same time; the user removes one.
  const names = openIssues.map((i) => nameKey(i.title));
  const isDouble = (/** @type {Issue} */ i) => names.filter((n) => n === nameKey(i.title)).length > 1;
  const open = openIssues.map((i) => toItem(i, isDouble(i)));
  // Removed ones (not planned) never go in.
  const since = Date.parse(mandjeSince);
  const closedAt = (/** @type {Issue} */ i) => Date.parse(i.closedAt ?? '') || 0;
  const bought = (/** @type {Issue} */ i) => closedAt(i) >= since || tickedHere.some((ref) => matchesRef(i, ref));
  const mandje = all
    .filter((i) => i.state === 'closed' && i.stateReason === 'completed' && bought(i))
    .filter((i) => !zoom || plekKeys(i).includes(zoom.plek))
    .sort((a, b) => closedAt(b) - closedAt(a))
    .map((i) => toItem(i, false));
  const keys = [...new Set(open.flatMap((item) => plekKeys(item.issue)))];
  if (zoom && !keys.includes(zoom.plek)) keys.push(zoom.plek);
  keys.sort(byPlek);
  /** @param {PlekKey} plek */
  const itemsAt = (plek) => open.filter((item) => plekKeys(item.issue).includes(plek));
  return {
    chips: [
      { zoom: null, count: open.length, selected: zoom === null },
      ...keys.map((plek) => ({ zoom: { plek }, count: itemsAt(plek).length, selected: zoom?.plek === plek })),
    ],
    groups: keys
      .filter((plek) => !zoom || zoom.plek === plek)
      .map((plek) => ({ plek, items: itemsAt(plek).sort(byTitle) })),
    mandje,
  };
}

/**
 * Saves an edited Boodschap: only what changed is sent, and each Plek is a
 * `waar:` label added or removed on its own, so the partner's changes survive.
 * Returns false, saving nothing, when the name is blank.
 * @param {Store} store
 * @param {IssueRef} ref
 * @param {{ title: string, note: string, plekken: string[] }} draft plekken as typed
 */
export function saveBoodschap(store, ref, draft) {
  const issue = store.getState().issues.find((i) => matchesRef(i, ref));
  const title = draft.title.replace(/\s+/g, ' ').trim();
  if (!issue || !title) return false;
  const body = draft.note.trim();
  /** @type {{ title?: string, body?: string }} */
  const fields = {};
  if (title !== issue.title) fields.title = title;
  if (body !== issue.body.trim()) fields.body = body;
  if (Object.keys(fields).length > 0) store.update(ref, fields);

  // Compared normalised, so a label written by hand as "waar: Praxis" is left alone.
  const current = plekkenOf(issue);
  const kept = current.map(normalisePlek);
  const chosen = [...new Set(draft.plekken.map(normalisePlek).filter(Boolean))];
  const add = chosen.filter((p) => !kept.includes(p)).map((p) => PLEK_PREFIX + p);
  const remove = current.filter((p) => !chosen.includes(normalisePlek(p))).map((p) => PLEK_PREFIX + p);
  if (add.length + remove.length > 0) store.editLabels(ref, { add, remove });
  return true;
}

/**
 * The Plekken a Boodschap can be given: every `waar:` label in Nexus, plus
 * its own (which the label list may not have yet).
 * @param {string[]} labels all label names in Nexus
 * @param {Issue} issue
 */
export function plekChoices(labels, issue) {
  return knownPlekken(labels, [issue]);
}

/**
 * Every Plek in Nexus, alphabetically: the `waar:` labels, plus any these
 * issues have that the label list doesn't show yet.
 * @param {string[]} labels all label names in Nexus
 * @param {Issue[]} issues
 */
export function knownPlekken(labels, issues) {
  const fromLabels = labels.filter((l) => l.startsWith(PLEK_PREFIX)).map((l) => l.slice(PLEK_PREFIX.length));
  const fromIssues = issues.filter((i) => kindOf(i) === 'boodschap').flatMap(plekkenOf);
  return [...new Set([...fromLabels, ...fromIssues])].sort((a, b) => a.localeCompare(b, 'nl'));
}

/**
 * How a Plek is written in its label (Nexus ADR 0003). GitHub allows 50
 * characters in a label, and `waar: ` takes 6 of them.
 * @param {string} name
 */
export function normalisePlek(name) {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, PLEK_MAX).trim();
}

/** How Boodschap names are compared: no case, accents or extra spaces. @param {string} name */
export function nameKey(name) {
  return normalise(name).replace(/\s+/g, ' ').trim();
}

/** The Plekken of a Boodschap, from its `waar:` labels. @param {Issue} issue @returns {string[]} */
export function plekkenOf(issue) {
  return issue.labels.filter((l) => l.startsWith(PLEK_PREFIX)).map((l) => l.slice(PLEK_PREFIX.length));
}

/** Where a Boodschap is listed: each of its Plekken, or "Geen plek". @param {Issue} issue @returns {PlekKey[]} */
function plekKeys(issue) {
  const plekken = plekkenOf(issue);
  return plekken.length > 0 ? plekken : [null];
}

/** @param {Issue} issue @param {boolean} double @returns {Item} */
function toItem(issue, double) {
  return { issue, note: issue.body.trim().replace(/\s*\n\s*/g, ' · '), double };
}

/** Alphabetical, "Geen plek" last. @param {PlekKey} a @param {PlekKey} b */
function byPlek(a, b) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a.localeCompare(b, 'nl');
}

/** @param {Item} a @param {Item} b */
function byTitle(a, b) {
  return nameKey(a.issue.title).localeCompare(nameKey(b.issue.title), 'nl');
}
