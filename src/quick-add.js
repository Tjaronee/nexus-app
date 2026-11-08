import { PRIO_LABELS } from './data/model.js';
import { SOORT_PREFIX, knownSoorten } from './soort.js';
import { GEPARKEERD_PREFIX } from './geparkeerd.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {import('./taken.js').Filters} Filters */
/** @typedef {import('./geparkeerd.js').Month} Month */
/**
 * What the quick-add sheet has filled in. `soort` is a known Soort's name, or
 * null for none; `geparkeerd` the month it is Geparkeerd until, or null;
 * `toegewezen` holds logins, `blockedBy` what it is Geblokkeerd door and
 * `blocks` what it Blokkeert.
 * @typedef {{
 *   title: string,
 *   body: string,
 *   prio: Prio,
 *   soort: string | null,
 *   geparkeerd: Month | null,
 *   toegewezen: string[],
 *   blockedBy: IssueRef[],
 *   blocks: IssueRef[],
 * }} Draft
 */

/** A new Taak is middel (Nexus ADR 0001) and nothing else. @type {Draft} */
export const DEFAULTS = {
  title: '',
  body: '',
  prio: 'middel',
  soort: null,
  geparkeerd: null,
  toegewezen: [],
  blockedBy: [],
  blocks: [],
};

/**
 * Creates the Taak, then records what blocks it and what it Blokkeert.
 * These are queued in order, so they work offline and for a blocker that is
 * itself still being created. Returns the new issue's ref, or null when the
 * title is blank.
 * @param {Store} store
 * @param {Draft} draft
 * @returns {IssueRef | null}
 */
export function saveDraft(store, draft) {
  const title = draft.title.trim();
  if (!title) return null;
  const ref = store.create({
    title,
    body: draft.body.trim(),
    labels: [
      PRIO_LABELS[draft.prio],
      ...(draft.soort ? [SOORT_PREFIX + draft.soort] : []),
      ...(draft.geparkeerd ? [GEPARKEERD_PREFIX + draft.geparkeerd] : []),
    ],
    assignees: draft.toegewezen,
  });
  for (const blocker of draft.blockedBy) store.addBlockedBy(ref, blocker);
  for (const blocked of draft.blocks) store.addBlockedBy(blocked, ref);
  return ref;
}

/**
 * The Soort a new Taak starts with, from the Taken filter: the Soort when
 * exactly one Soort chip is on, else none. As with a zoomed-in Plek on
 * Boodschappen, what you are looking at is what you are adding to.
 * @param {Filters} filters the filters that apply now
 * @returns {string | null}
 */
export function soortFromFilter(filters) {
  const [only, ...others] = filters.soort;
  return others.length === 0 && only ? only : null;
}

/**
 * What the sheet offers: every known Soort as a chip, and in the "meer"
 * section who a Taak can be Toegewezen to. That is me, then everyone who
 * has been Toegewezen in Nexus before.
 * @param {{ issues: Issue[], labels?: string[] }} state `labels` all label names in Nexus
 * @param {string} me the signed-in login
 */
export function choices({ issues, labels = [] }, me) {
  /** @type {string[]} */
  const people = me ? [me] : [];
  for (const { login } of issues.flatMap((i) => i.assignees)) {
    if (!people.some((p) => p.toLowerCase() === login.toLowerCase())) people.push(login);
  }

  return {
    people,
    soorten: knownSoorten(labels, issues),
  };
}
