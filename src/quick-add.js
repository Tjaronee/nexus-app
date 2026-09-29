import { kindOf, PRIO_LABELS, URGENTIE_LABELS } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {import('./data/model.js').Urgentie} Urgentie */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/**
 * What the quick-add sheet has filled in. `toegewezen` holds logins.
 * @typedef {{
 *   title: string,
 *   body: string,
 *   prio: Prio,
 *   urgentie: Urgentie,
 *   epic: IssueRef | null,
 *   mijlpaal: number | null,
 *   toegewezen: string[],
 *   blockedBy: IssueRef[],
 * }} Draft
 */

/** A new Taak is middel / binnenkort (Nexus ADR 0001) and nothing else. @type {Draft} */
export const DEFAULTS = {
  title: '',
  body: '',
  prio: 'middel',
  urgentie: 'binnenkort',
  epic: null,
  mijlpaal: null,
  toegewezen: [],
  blockedBy: [],
};

/**
 * Creates the Taak, then puts it under its Epic and records what blocks it.
 * These are queued in order, so they work offline and for an Epic or blocker
 * that is itself still being created. Returns the new Taak's ref, or null
 * when the title is blank.
 * @param {Store} store
 * @param {Draft} draft
 * @returns {IssueRef | null}
 */
export function saveTaak(store, draft) {
  const title = draft.title.trim();
  if (!title) return null;
  const ref = store.create({
    title,
    body: draft.body.trim(),
    labels: [PRIO_LABELS[draft.prio], URGENTIE_LABELS[draft.urgentie]],
    assignees: draft.toegewezen,
    milestone: draft.mijlpaal,
  });
  if (draft.epic !== null) store.setParent(ref, draft.epic);
  for (const blocker of draft.blockedBy) store.addBlockedBy(ref, blocker);
  return ref;
}

/**
 * What the "meer" section offers: open Epics, Mijlpalen and Taken by name,
 * and who a Taak can be Toegewezen to. That is me, then everyone who has
 * been Toegewezen in Nexus before.
 * @param {{ issues: Issue[], milestones: Milestone[] }} state
 * @param {string} me the signed-in login
 */
export function choices({ issues, milestones }, me) {
  const open = issues.filter((i) => i.state === 'open');
  /** @param {import('./data/model.js').Kind} kind */
  const ofKind = (kind) =>
    open
      .filter((i) => kindOf(i) === kind)
      .map((i) => ({ ref: i.ref, title: i.title }))
      .sort(byTitle);

  /** @type {string[]} */
  const people = [me];
  for (const { login } of issues.flatMap((i) => i.assignees)) {
    if (!people.some((p) => p.toLowerCase() === login.toLowerCase())) people.push(login);
  }

  return {
    epics: ofKind('epic'),
    mijlpalen: milestones.filter((m) => m.state === 'open').map((m) => ({ number: m.number, title: m.title })).sort(byTitle),
    blockers: ofKind('taak'),
    people,
  };
}

/** @param {{ title: string }} a @param {{ title: string }} b */
const byTitle = (a, b) => a.title.localeCompare(b.title, 'nl');
