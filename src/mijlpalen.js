import { kindOf } from './data/model.js';
import { takenRows } from './taken.js';
import { groupBySoort } from './soort.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {{ closed: number, total: number }} Progress */
/** @typedef {{ number: number, title: string, progress: Progress }} MijlpaalSummary */

/**
 * The Mijlpalen section of Indeling: the open Mijlpalen, each with its
 * progress, and the Afgeronde ones apart. Both go by creation, oldest first.
 * @param {Issue[]} issues
 * @param {Milestone[]} milestones
 */
export function mijlpalenOverview(issues, milestones) {
  /** @param {Milestone} m @returns {MijlpaalSummary} */
  const summary = (m) => ({
    number: m.number,
    title: m.title,
    progress: progressOf(issues.filter((i) => i.milestone?.number === m.number)),
  });
  return {
    open: milestones.filter((m) => m.state === 'open').sort(byCreation).map(summary),
    closed: milestones.filter((m) => m.state === 'closed').sort(byCreation).map(summary),
  };
}

/**
 * A Mijlpaal's screen: its open Taken like the Taken list, grouped by Soort
 * with the Geblokkeerd ones apart. They all share this Mijlpaal, so the rows
 * carry no breadcrumb.
 *
 * It can be deleted only when nothing has it (Nexus ADR 0004): GitHub would
 * delete it anyway and take it off those issues. Closed issues and
 * Boodschappen count too, and so does GitHub's own count, which includes
 * pull requests the app doesn't load.
 * @param {Issue[]} issues
 * @param {Milestone[]} milestones
 * @param {number} number
 */
export function mijlpaalView(issues, milestones, number) {
  const milestone = milestones.find((m) => m.number === number);
  if (!milestone) return null;
  const inMijlpaal = issues.filter((i) => i.milestone?.number === number);
  const open = inMijlpaal.filter((i) => i.state === 'open' && kindOf(i) === 'taak');
  const rows = takenRows(issues, open).map((row) => ({ ...row, breadcrumb: [] }));
  return {
    number,
    title: milestone.title,
    description: milestone.description,
    state: milestone.state,
    progress: progressOf(inMijlpaal),
    groups: groupBySoort(rows.filter((r) => r.waitingFor.length === 0)),
    blocked: rows.filter((r) => r.waitingFor.length > 0),
    canDelete: inMijlpaal.length === 0 && (milestone.issueCount ?? 0) === 0,
  };
}

/** @param {Issue[]} list @returns {Progress} */
function progressOf(list) {
  return { closed: list.filter((i) => i.state === 'closed').length, total: list.length };
}

/** GitHub numbers Mijlpalen in the order they were made. @param {Milestone} a @param {Milestone} b */
const byCreation = (a, b) => a.number - b.number;
