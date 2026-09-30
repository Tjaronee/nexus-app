import { kindOf, matchesRef, BOODSCHAPPEN_LABEL } from './data/model.js';
import { nameKey, normalisePlek, plekkenOf, PLEK_PREFIX } from './boodschappen.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {{ issue: Issue, open: boolean }} Suggestion */
/** What saving did: made a new one, put a closed one back, or found it open. @typedef {'nieuw' | 'terug' | 'al-op-lijst'} Outcome */

const MAX_SUGGESTIONS = 5;

/**
 * Earlier Boodschappen whose name contains what was typed, open or closed,
 * so an old one can be put back instead of made again. Each name once: the
 * open issue if there is one, else the one closed last. Names that start
 * with the typed text come first.
 * @param {Issue[]} issues
 * @param {string} query
 * @returns {Suggestion[]}
 */
export function suggestions(issues, query) {
  const typed = nameKey(query);
  if (!typed) return [];
  return [...oneIssuePerName(issues)]
    .filter(([key]) => key.includes(typed))
    .sort(([a], [b]) => Number(!a.startsWith(typed)) - Number(!b.startsWith(typed)) || a.localeCompare(b, 'nl'))
    .slice(0, MAX_SUGGESTIONS)
    .map(([, issue]) => ({ issue, open: issue.state === 'open' }));
}

/**
 * Adds a Boodschap. A name that is already known is never made twice
 * (Nexus ADR 0003): an open one only gets the newly chosen Plekken, a closed
 * one is reopened with its old Plekken kept. `pick` is a chosen suggestion,
 * used whatever was typed. Returns null, saving nothing, for a blank name.
 * @param {Store} store
 * @param {{ name: string, note: string, plekken: string[] }} draft plekken as typed
 * @param {IssueRef | null} [pick]
 * @returns {{ outcome: Outcome, ref: IssueRef } | null}
 */
export function addBoodschap(store, draft, pick = null) {
  const name = draft.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const note = draft.note.trim();
  const plekken = [...new Set(draft.plekken.map(normalisePlek).filter(Boolean))];
  const { issues } = store.getState();
  const existing =
    pick !== null
      ? issues.find((i) => matchesRef(i, pick))
      : oneIssuePerName(issues).get(nameKey(name));

  if (!existing) {
    const labels = [BOODSCHAPPEN_LABEL, ...plekken.map((p) => PLEK_PREFIX + p)];
    return { outcome: 'nieuw', ref: store.create({ title: name, body: note, labels }) };
  }
  const has = plekkenOf(existing).map(normalisePlek);
  const add = plekken.filter((p) => !has.includes(p)).map((p) => PLEK_PREFIX + p);
  if (add.length > 0) store.editLabels(existing.ref, { add });
  // A new note replaces an old one from last time, but never the partner's on an open one.
  const replaceable = existing.state === 'closed' || existing.body.trim() === '';
  if (note && note !== existing.body.trim() && replaceable) store.update(existing.ref, { body: note });
  if (existing.state === 'open') return { outcome: 'al-op-lijst', ref: existing.ref };
  store.reopen(existing.ref);
  return { outcome: 'terug', ref: existing.ref };
}

/**
 * Every Boodschap name, with the issue it stands for: the open one if there
 * is one, else the one closed last.
 * @param {Issue[]} issues
 */
function oneIssuePerName(issues) {
  /** @type {Map<string, Issue>} */
  const byName = new Map();
  for (const issue of issues) {
    if (kindOf(issue) !== 'boodschap') continue;
    const key = nameKey(issue.title);
    const known = byName.get(key);
    if (!known || preferred(issue, known)) byName.set(key, issue);
  }
  return byName;
}

/** Open wins; between closed ones, the one touched last. @param {Issue} a @param {Issue} b */
function preferred(a, b) {
  if (a.state !== b.state) return a.state === 'open';
  return a.updatedAt > b.updatedAt;
}
