import { kindOf, matchesRef } from './data/model.js';
import { normalise } from './text.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** A Plek name, or null for "Geen plek". @typedef {string | null} PlekKey */
/** @typedef {{ issue: Issue, note: string }} Item */
/** Zoomed in on one Plek, or null for all of them. @typedef {{ plek: PlekKey } | null} Zoom */

export const PLEK_PREFIX = 'waar: ';

/**
 * The Boodschappen tab: the open Boodschappen grouped by Plek, and a chip per
 * Plek to zoom in on it. A chip only exists for a Plek with something open,
 * except the one zoomed in on, so it can still be tapped to zoom out.
 * @param {Issue[]} issues
 * @param {{ zoom: Zoom, mandjeSince: string }} options
 */
export function boodschappenList(issues, { zoom, mandjeSince }) {
  const all = issues.filter((i) => kindOf(i) === 'boodschap');
  const open = all.filter((i) => i.state === 'open').map(toItem);
  // Bought since the list was last cleared; removed ones (not planned) never go in.
  const since = Date.parse(mandjeSince);
  const closedAt = (/** @type {Issue} */ i) => Date.parse(i.closedAt ?? '') || 0;
  const mandje = all
    .filter((i) => i.state === 'closed' && i.stateReason === 'completed' && closedAt(i) >= since)
    .filter((i) => !zoom || plekKeys(i).includes(zoom.plek))
    .sort((a, b) => closedAt(b) - closedAt(a))
    .map(toItem);
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

  const current = plekkenOf(issue);
  const chosen = [...new Set(draft.plekken.map(normalisePlek).filter(Boolean))];
  const add = chosen.filter((p) => !current.includes(p)).map((p) => PLEK_PREFIX + p);
  const remove = current.filter((p) => !chosen.includes(p)).map((p) => PLEK_PREFIX + p);
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
  const known = labels.filter((l) => l.startsWith(PLEK_PREFIX)).map((l) => l.slice(PLEK_PREFIX.length));
  return [...new Set([...known, ...plekkenOf(issue)])].sort((a, b) => a.localeCompare(b, 'nl'));
}

/** How a Plek is written in its label (Nexus ADR 0003). @param {string} name */
export function normalisePlek(name) {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
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

/** @param {Issue} issue @returns {Item} */
function toItem(issue) {
  return { issue, note: issue.body.trim().replace(/\s*\n\s*/g, ' · ') };
}

/** Alphabetical, "Geen plek" last. @param {PlekKey} a @param {PlekKey} b */
function byPlek(a, b) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a.localeCompare(b, 'nl');
}

/** @param {Item} a @param {Item} b */
function byTitle(a, b) {
  return normalise(a.issue.title).localeCompare(normalise(b.issue.title), 'nl');
}
