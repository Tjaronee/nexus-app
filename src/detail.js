import { blocking, matchesRef, prioOf, urgentieOf } from './data/model.js';
import { choices } from './quick-add.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/store.js').Milestone} Milestone */

/**
 * A Taak as its detail screen shows it. "Geblokkeerd door" keeps closed
 * blockers too, so they can still be removed; one the app doesn't know
 * (`known: false`) shows by number, and can only be removed. "Blokkeert"
 * lists the open Taken it blocks, in the same shape.
 * @param {Issue[]} issues
 * @param {IssueRef} ref
 */
export function detailOf(issues, ref) {
  const issue = issues.find((i) => matchesRef(i, ref));
  if (!issue) return null;
  return {
    issue,
    prio: prioOf(issue),
    urgentie: urgentieOf(issue),
    blockedBy: issue.blockedBy.map((blockerRef) => {
      const blocker = issues.find((i) => matchesRef(i, blockerRef));
      return blocker
        ? { ref: blocker.ref, title: blocker.title, open: blocker.state === 'open', known: true }
        : { ref: blockerRef, title: typeof blockerRef === 'number' ? `#${blockerRef}` : 'Onbekende Taak', open: true, known: false };
    }),
    blocking: blocking(issues, issue).map((i) => ({ ref: i.ref, title: i.title, open: true, known: true })),
  };
}

/**
 * Who to add and remove so the Toegewezen people become `chosen`.
 * @param {string[]} current logins Toegewezen now
 * @param {string[]} chosen logins ticked on the screen
 */
export function assigneeChange(current, chosen) {
  return {
    add: chosen.filter((l) => !has(current, l)),
    remove: current.filter((l) => !has(chosen, l)),
  };
}

/**
 * What the Epic, Mijlpaal and Toegewezen pickers offer for this Taak, and
 * what it has now: `epic` and `mijlpaal` are indexes into the lists (-1 for
 * none), `toegewezen` the logins to tick. An Epic or Mijlpaal it belongs to
 * stays choosable after it closes, and so does anyone it is Toegewezen to.
 * @param {{ issues: Issue[], milestones: Milestone[] }} state
 * @param {Issue} issue
 * @param {string} me the signed-in login
 */
export function editChoices(state, issue, me) {
  const { epics, mijlpalen, people } = choices(state, me);
  const parent = issue.parent === null ? undefined : state.issues.find((i) => i.number === issue.parent);
  if (parent && !epics.some((e) => e.ref === parent.ref)) epics.push({ ref: parent.ref, title: parent.title });
  const milestone = issue.milestone;
  if (milestone && !mijlpalen.some((m) => m.number === milestone.number)) mijlpalen.push(milestone);
  const assigned = issue.assignees.map((a) => a.login);
  for (const login of assigned) if (!has(people, login)) people.push(login);
  return {
    epics,
    epic: parent ? epics.findIndex((e) => e.ref === parent.ref) : -1,
    mijlpalen,
    mijlpaal: milestone ? mijlpalen.findIndex((m) => m.number === milestone.number) : -1,
    people,
    toegewezen: people.filter((login) => has(assigned, login)),
  };
}

/** GitHub logins ignore case. @param {string[]} logins @param {string} login */
const has = (logins, login) => logins.some((l) => l.toLowerCase() === login.toLowerCase());
