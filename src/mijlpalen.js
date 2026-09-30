import { kindOf, matchesRef } from './data/model.js';
import { takenRows } from './taken.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {{ closed: number, total: number }} Progress */
/** @typedef {{ number: number, title: string, progress: Progress }} MijlpaalSummary */
/** @typedef {{ issue: Issue, progress: Progress }} EpicSummary */

/**
 * The Mijlpalen tab: the open Mijlpalen, each with its progress, the closed
 * ones apart, and the open Epics that have no Mijlpaal.
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
    zonder: topEpics(issues, null)
      .filter((e) => e.state === 'open')
      .map((e) => epicSummary(issues, e)),
  };
}

/**
 * A Mijlpaal's screen: its Epics and its open Taken that are not in one of
 * those Epics. A Taak whose Epic is elsewhere shows here too, so none is lost.
 * @param {Issue[]} issues
 * @param {Milestone[]} milestones
 * @param {number} number
 */
export function mijlpaalView(issues, milestones, number) {
  const milestone = milestones.find((m) => m.number === number);
  if (!milestone) return null;
  const inMijlpaal = issues.filter((i) => i.milestone?.number === number);
  const epicNumbers = inMijlpaal.filter((i) => kindOf(i) === 'epic').map((e) => e.number);
  const loose = inMijlpaal.filter(
    (i) => i.state === 'open' && kindOf(i) === 'taak' && (i.parent === null || !epicNumbers.includes(i.parent)),
  );
  return {
    title: milestone.title,
    description: milestone.description,
    progress: progressOf(inMijlpaal),
    epics: topEpics(issues, number).map((e) => epicSummary(issues, e)),
    taken: rowsWithoutCrumbs(issues, loose),
  };
}

/**
 * An Epic's screen: its description, its open Taken, and the Epics under it.
 * @param {Issue[]} issues
 * @param {IssueRef} ref
 */
export function epicView(issues, ref) {
  const epic = issues.find((i) => matchesRef(i, ref));
  if (!epic) return null;
  const children = childrenOf(issues, epic);
  return {
    title: epic.title,
    description: epic.body,
    progress: progressOf(children),
    epics: children
      .filter((i) => kindOf(i) === 'epic')
      .sort(openFirst)
      .map((e) => epicSummary(issues, e)),
    taken: rowsWithoutCrumbs(
      issues,
      children.filter((i) => i.state === 'open' && kindOf(i) === 'taak'),
    ),
  };
}

/**
 * The screen already says which Epic and Mijlpaal these Taken are in.
 * @param {Issue[]} issues @param {Issue[]} taken
 */
function rowsWithoutCrumbs(issues, taken) {
  return takenRows(issues, taken).map((row) => ({ ...row, breadcrumb: [] }));
}

/**
 * The Epics in a Mijlpaal (or, for null, in none) that are not under another
 * of those Epics; one that is shows inside that Epic instead. Open ones first.
 * @param {Issue[]} issues
 * @param {number | null} mijlpaal
 */
function topEpics(issues, mijlpaal) {
  const epics = issues.filter((i) => kindOf(i) === 'epic' && (i.milestone?.number ?? null) === mijlpaal);
  return epics.filter((e) => !epics.some((other) => other.number !== null && other.number === e.parent)).sort(openFirst);
}

/** Progress counts the Epic's direct sub-issues. @param {Issue[]} issues @param {Issue} epic @returns {EpicSummary} */
function epicSummary(issues, epic) {
  return { issue: epic, progress: progressOf(childrenOf(issues, epic)) };
}

/** @param {Issue[]} issues @param {Issue} epic */
const childrenOf = (issues, epic) => (epic.number === null ? [] : issues.filter((i) => i.parent === epic.number));

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

/** @param {Issue} a @param {Issue} b */
function openFirst(a, b) {
  return Number(a.state === 'closed') - Number(b.state === 'closed') || a.createdAt.localeCompare(b.createdAt);
}
