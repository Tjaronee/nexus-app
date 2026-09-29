import { blocking, kindOf, matchesRef, prioOf, urgentieOf } from './data/model.js';
import { normalise } from './taken.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */

/**
 * A Taak as its detail screen shows it. "Geblokkeerd door" keeps closed
 * blockers too, so they can still be removed; one the app doesn't know
 * shows by number.
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
        ? { ref: blocker.ref, title: blocker.title, open: blocker.state === 'open' }
        : { ref: blockerRef, title: `#${blockerRef}`, open: true };
    }),
    blocking: blocking(issues, issue).map((i) => ({ ref: i.ref, title: i.title })),
  };
}

/**
 * The open Taken that could block this one, by title, for the "+ geblokkeerd
 * door…" search. The query matches the title or the issue number.
 * @param {Issue[]} issues
 * @param {Issue} issue
 * @param {string} query
 */
export function blockerOptions(issues, issue, query) {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  return issues
    .filter((i) => i.state === 'open' && kindOf(i) === 'taak' && !matchesRef(issue, i.ref))
    .filter((i) => !issue.blockedBy.some((ref) => matchesRef(i, ref)))
    .filter((i) => {
      const text = `${normalise(i.title)} #${i.number ?? ''}`;
      return terms.every((t) => text.includes(t));
    })
    .map((i) => ({ ref: i.ref, title: i.title, number: i.number }))
    .sort((a, b) => a.title.localeCompare(b.title, 'nl'));
}

/**
 * Who to add and remove so the Toegewezen people become `chosen`.
 * @param {string[]} current logins Toegewezen now
 * @param {string[]} chosen logins ticked on the screen
 */
export function assigneeChange(current, chosen) {
  /** @param {string[]} list @param {string} login */
  const has = (list, login) => list.some((l) => l.toLowerCase() === login.toLowerCase());
  return {
    add: chosen.filter((l) => !has(current, l)),
    remove: current.filter((l) => !has(chosen, l)),
  };
}
