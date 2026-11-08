import { blocking, matchesRef, prioOf } from './data/model.js';
import { choices } from './quick-add.js';
import { soortOf, tapSoort, soortChange } from './soort.js';
import { parkChange } from './geparkeerd.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */

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
    soort: soortOf(issue),
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
 * What the Soort chips and the Toegewezen picker offer for this Taak, and
 * what it has now: `toegewezen` the logins to tick. Its Soort stays
 * choosable, and so does anyone it is Toegewezen to.
 * @param {{ issues: Issue[], labels?: string[] }} state
 * @param {Issue} issue
 * @param {string} me the signed-in login
 */
export function editChoices(state, issue, me) {
  const { people, soorten } = choices(state, me);
  const soort = soortOf(issue);
  if (soort && !soorten.includes(soort)) soorten.push(soort);
  const assigned = issue.assignees.map((a) => a.login);
  for (const login of assigned) if (!has(people, login)) people.push(login);
  return {
    people,
    toegewezen: people.filter((login) => has(assigned, login)),
    soorten,
  };
}

/**
 * Taps a Soort chip on the detail screen: moves the Taak to that Soort, or to
 * Geen soort when it already had it. Queued, so it works offline.
 * @param {import('./quick-add.js').Store} store
 * @param {IssueRef} ref
 * @param {string} tapped
 */
export function tapSoortChip(store, ref, tapped) {
  const detail = detailOf(store.getState().issues, ref);
  if (!detail) return;
  const change = soortChange(detail.issue.labels, tapSoort(detail.soort, tapped));
  if (change.add.length + change.remove.length > 0) store.editLabels(ref, change);
}

/**
 * Parks the Taak until `month`, replacing any month it had, or with null
 * makes it Niet geparkeerd. Queued, so it works offline.
 * @param {import('./quick-add.js').Store} store
 * @param {IssueRef} ref
 * @param {import('./geparkeerd.js').Month | null} month
 */
export function parkTaak(store, ref, month) {
  const detail = detailOf(store.getState().issues, ref);
  if (!detail) return;
  const change = parkChange(detail.issue.labels, month);
  if (change.add.length + change.remove.length > 0) store.editLabels(ref, change);
}

/** GitHub logins ignore case. @param {string[]} logins @param {string} login */
const has = (logins, login) => logins.some((l) => l.toLowerCase() === login.toLowerCase());

/**
 * The Reactie to post for what was typed, or null when there is only
 * whitespace: then there is nothing to say, and Plaatsen stays off.
 * @param {string} text
 */
export function reactieBody(text) {
  const body = text.trim();
  return body === '' ? null : body;
}

/**
 * Posts a Reactie on the Taak. It is queued, so it shows at once as
 * "wordt verstuurd" and goes out when the phone is online. False, posting
 * nothing, when the text is empty.
 * @param {import('./quick-add.js').Store} store
 * @param {IssueRef} ref
 * @param {string} text
 */
export function postReactie(store, ref, text) {
  const body = reactieBody(text);
  if (body === null) return false;
  store.comment(ref, body);
  return true;
}
