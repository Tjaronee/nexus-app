import { kindOf } from './data/model.js';
import { takenRows } from './taken.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {{ closed: number, total: number }} Progress */
/** @typedef {{ number: number, title: string, progress: Progress }} MijlpaalSummary */

/**
 * The Mijlpalen tab: the open Mijlpalen, each with its progress, and the
 * closed ones apart.
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
    open: milestones
      .filter((m) => m.state === 'open')
      .sort(byDueDate)
      .map(summary),
    closed: milestones.filter((m) => m.state === 'closed').map(summary),
  };
}

/**
 * A Mijlpaal's screen: its open Taken as one list, sorted like the Taken list.
 * They all share this Mijlpaal, so the rows carry no breadcrumb.
 * @param {Issue[]} issues
 * @param {Milestone[]} milestones
 * @param {number} number
 */
export function mijlpaalView(issues, milestones, number) {
  const milestone = milestones.find((m) => m.number === number);
  if (!milestone) return null;
  const inMijlpaal = issues.filter((i) => i.milestone?.number === number);
  const open = inMijlpaal.filter((i) => i.state === 'open' && kindOf(i) === 'taak');
  return {
    title: milestone.title,
    description: milestone.description,
    progress: progressOf(inMijlpaal),
    taken: takenRows(issues, open).map((row) => ({ ...row, breadcrumb: [] })),
  };
}

/** @param {Issue[]} list @returns {Progress} */
function progressOf(list) {
  return { closed: list.filter((i) => i.state === 'closed').length, total: list.length };
}

/** @param {Milestone} a @param {Milestone} b */
function byDueDate(a, b) {
  if (a.dueOn === b.dueOn) return a.number - b.number;
  if (a.dueOn === null) return 1;
  if (b.dueOn === null) return -1;
  return a.dueOn.localeCompare(b.dueOn);
}
