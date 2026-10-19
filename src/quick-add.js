import { PRIO_LABELS, URGENTIE_LABELS } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {import('./data/model.js').Urgentie} Urgentie */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/**
 * What the quick-add sheet has filled in. `toegewezen` holds logins,
 * `blockedBy` what it is Geblokkeerd door and `blocks` what it Blokkeert.
 * @typedef {{
 *   title: string,
 *   body: string,
 *   prio: Prio,
 *   urgentie: Urgentie,
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
    labels: [PRIO_LABELS[draft.prio], URGENTIE_LABELS[draft.urgentie]],
    assignees: draft.toegewezen,
  });
  for (const blocker of draft.blockedBy) store.addBlockedBy(ref, blocker);
  for (const blocked of draft.blocks) store.addBlockedBy(blocked, ref);
  return ref;
}

/**
 * What the "meer" section offers: open Mijlpalen by name, and who
 * a Taak can be Toegewezen to. That is me, then everyone who has been
 * Toegewezen in Nexus before.
 * @param {{ issues: Issue[], milestones: Milestone[] }} state
 * @param {string} me the signed-in login
 */
export function choices({ issues, milestones }, me) {
  /** @type {string[]} */
  const people = me ? [me] : [];
  for (const { login } of issues.flatMap((i) => i.assignees)) {
    if (!people.some((p) => p.toLowerCase() === login.toLowerCase())) people.push(login);
  }

  return {
    mijlpalen: milestones.filter((m) => m.state === 'open').map((m) => ({ number: m.number, title: m.title })).sort(byTitle),
    people,
  };
}

/** @param {{ title: string }} a @param {{ title: string }} b */
const byTitle = (a, b) => a.title.localeCompare(b.title, 'nl');
