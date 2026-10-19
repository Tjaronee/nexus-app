import { PRIO_LABELS, URGENTIE_LABELS } from './data/model.js';
import { SOORT_PREFIX, knownSoorten } from './soort.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {import('./data/model.js').Urgentie} Urgentie */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {import('./taken.js').Filters} Filters */
/**
 * What the quick-add sheet has filled in. `soort` is a known Soort's name, or
 * null for none; `toegewezen` holds logins, `blockedBy` what it is
 * Geblokkeerd door and `blocks` what it Blokkeert.
 * @typedef {{
 *   title: string,
 *   body: string,
 *   prio: Prio,
 *   urgentie: Urgentie,
 *   soort: string | null,
 *   mijlpaal: number | null,
 *   toegewezen: string[],
 *   blockedBy: IssueRef[],
 *   blocks: IssueRef[],
 * }} Draft
 */

/** A new Taak is middel / binnenkort (Nexus ADR 0001) and nothing else. @type {Draft} */
export const DEFAULTS = {
  title: '',
  body: '',
  prio: 'middel',
  urgentie: 'binnenkort',
  soort: null,
  mijlpaal: null,
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
    milestone: draft.mijlpaal,
    labels: [PRIO_LABELS[draft.prio], URGENTIE_LABELS[draft.urgentie], ...(draft.soort ? [SOORT_PREFIX + draft.soort] : [])],
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
 * section open Mijlpalen by name and who a Taak can be Toegewezen to. That
 * is me, then everyone who has been Toegewezen in Nexus before.
 * @param {{ issues: Issue[], milestones: Milestone[], labels?: string[] }} state `labels` all label names in Nexus
 * @param {string} me the signed-in login
 */
export function choices({ issues, milestones, labels = [] }, me) {
  /** @type {string[]} */
  const people = me ? [me] : [];
  for (const { login } of issues.flatMap((i) => i.assignees)) {
    if (!people.some((p) => p.toLowerCase() === login.toLowerCase())) people.push(login);
  }

  return {
    mijlpalen: milestones.filter((m) => m.state === 'open').map((m) => ({ number: m.number, title: m.title })).sort(byTitle),
    people,
    soorten: knownSoorten(labels, issues),
  };
}

/** @param {{ title: string }} a @param {{ title: string }} b */
const byTitle = (a, b) => a.title.localeCompare(b.title, 'nl');
