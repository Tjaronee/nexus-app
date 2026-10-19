import { kindOf } from './data/model.js';
import { labelName } from './text.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** A Soort name, or null for "Geen soort". @typedef {string | null} SoortKey */

export const SOORT_PREFIX = 'soort: ';

/** What the "Geen soort" group and chip are called. */
export const GEEN_SOORT = 'Geen soort';

/** How a Soort is written in its label: the same way as a Plek (Nexus ADR 0004). @param {string} name */
export function normaliseSoort(name) {
  return labelName(name, SOORT_PREFIX);
}

/**
 * The Soort of a Taak, from its `soort:` label. A Taak has at most one, but
 * two can be set by hand on github.com; then the alphabetically first counts.
 * @param {Issue} issue
 * @returns {SoortKey}
 */
export function soortOf(issue) {
  const soorten = issue.labels
    .filter((l) => l.startsWith(SOORT_PREFIX))
    .map((l) => normaliseSoort(l.slice(SOORT_PREFIX.length)))
    .filter(Boolean)
    .sort(byName);
  return soorten[0] ?? null;
}

/**
 * Every Soort in Nexus, alphabetically: the `soort:` labels, plus any these
 * open Taken have that the label list doesn't show yet.
 * @param {string[]} labels all label names in Nexus
 * @param {Issue[]} [issues]
 * @returns {string[]}
 */
export function knownSoorten(labels, issues = []) {
  const fromLabels = labels.filter((l) => l.startsWith(SOORT_PREFIX)).map((l) => normaliseSoort(l.slice(SOORT_PREFIX.length)));
  const fromIssues = issues.filter((i) => i.state === 'open' && kindOf(i) === 'taak').map(soortOf);
  return [...new Set([...fromLabels, ...fromIssues])].filter((s) => !!s).map(String).sort(byName);
}

/**
 * The Soort after tapping a Soort chip on quick-add or the detail screen:
 * the tapped one, or none when it was already chosen.
 * @param {SoortKey} current @param {string} tapped
 * @returns {SoortKey}
 */
export function tapSoort(current, tapped) {
  return tapped === current ? null : tapped;
}

/**
 * The labels to add and remove so a Taak with these labels has `chosen` as
 * its only Soort (Nexus ADR 0004). A label for it written by hand, such as
 * "soort: Klusjes", is kept as it is; every other `soort:` label goes, so
 * two set by hand end as one.
 * @param {string[]} labels the Taak's labels now
 * @param {SoortKey} chosen
 * @returns {{ add: string[], remove: string[] }}
 */
export function soortChange(labels, chosen) {
  const current = labels.filter((l) => l.startsWith(SOORT_PREFIX));
  const kept = current.find((l) => chosen !== null && normaliseSoort(l.slice(SOORT_PREFIX.length)) === chosen);
  return {
    add: chosen === null || kept ? [] : [SOORT_PREFIX + chosen],
    remove: current.filter((l) => l !== kept),
  };
}

/**
 * These rows in one group per Soort, alphabetically, "Geen soort" last. The
 * rows keep their order within a group, and Soorten without rows are left out.
 * @template {{ soort: SoortKey }} R
 * @param {R[]} rows
 * @returns {{ soort: SoortKey, rows: R[] }[]}
 */
export function groupBySoort(rows) {
  const keys = [...new Set(rows.map((r) => r.soort))].sort(bySoort);
  return keys.map((soort) => ({ soort, rows: rows.filter((r) => r.soort === soort) }));
}

/** @param {string} a @param {string} b */
function byName(a, b) {
  return a.localeCompare(b, 'nl');
}

/** Alphabetical, "Geen soort" last. @param {SoortKey} a @param {SoortKey} b */
function bySoort(a, b) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return byName(a, b);
}
