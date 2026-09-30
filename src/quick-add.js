import { kindOf, EPIC_LABEL, PRIO_LABELS, URGENTIE_LABELS } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/model.js').Prio} Prio */
/** @typedef {import('./data/model.js').Urgentie} Urgentie */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/**
 * What the quick-add sheet has filled in. `toegewezen` holds logins,
 * `blockedBy` what it is Geblokkeerd door and `blocks` what it Blokkeert. With
 * `isEpic` it makes an Epic, and only the title, body and Mijlpaal count.
 * @typedef {{
 *   title: string,
 *   body: string,
 *   isEpic: boolean,
 *   prio: Prio,
 *   urgentie: Urgentie,
 *   epic: IssueRef | null,
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
  isEpic: false,
  prio: 'middel',
  urgentie: 'binnenkort',
  epic: null,
  mijlpaal: null,
  toegewezen: [],
  blockedBy: [],
  blocks: [],
};

/**
 * Creates the Taak, then puts it under its Epic and records what blocks it
 * and what it Blokkeert.
 * These are queued in order, so they work offline and for an Epic or blocker
 * that is itself still being created. An Epic gets the Epic label and no
 * Prio or Urgentie (Nexus ADR 0004). Returns the new issue's ref, or null
 * when the title is blank.
 * @param {Store} store
 * @param {Draft} draft
 * @returns {IssueRef | null}
 */
export function saveDraft(store, draft) {
  const title = draft.title.trim();
  if (!title) return null;
  const fields = { title, body: draft.body.trim(), milestone: draft.mijlpaal };
  if (draft.isEpic) return store.create({ ...fields, labels: [EPIC_LABEL] });
  const ref = store.create({
    ...fields,
    labels: [PRIO_LABELS[draft.prio], URGENTIE_LABELS[draft.urgentie]],
    assignees: draft.toegewezen,
  });
  if (draft.epic !== null) store.setParent(ref, draft.epic);
  for (const blocker of draft.blockedBy) store.addBlockedBy(ref, blocker);
  for (const blocked of draft.blocks) store.addBlockedBy(blocked, ref);
  return ref;
}

/**
 * What the "meer" section offers: open Epics and Mijlpalen by name, and who
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
    epics: issues
      .filter((i) => i.state === 'open' && kindOf(i) === 'epic')
      .map((i) => ({ ref: i.ref, title: i.title }))
      .sort(byTitle),
    mijlpalen: milestones.filter((m) => m.state === 'open').map((m) => ({ number: m.number, title: m.title })).sort(byTitle),
    people,
  };
}

/** @param {{ title: string }} a @param {{ title: string }} b */
const byTitle = (a, b) => a.title.localeCompare(b.title, 'nl');
