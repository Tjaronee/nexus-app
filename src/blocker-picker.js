import { blocking, kindOf, matchesRef } from './data/model.js';
import { normalise } from './text.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {{ ref: IssueRef, title: string, number: number | null }} BlockerOption */

/**
 * The open Taken that could block a Taak, for the "+ geblokkeerd door…"
 * search: nothing until something is typed, then those whose title or #number
 * holds every word, like Taken search. Left out are the Taak itself and Taken
 * already linked to it either way. `self` is null for a Taak not saved yet;
 * `chosen` is what it is Geblokkeerd door so far.
 * @param {Issue[]} issues
 * @param {{ self: Issue | null, chosen: IssueRef[] }} taak
 * @param {string} query
 * @returns {BlockerOption[]}
 */
export function blockerOptions(issues, { self, chosen }, query) {
  const terms = normalise(query).split(/\s+/).filter((t) => t !== '' && t !== '#');
  if (terms.length === 0) return [];
  const blocked = self ? blocking(issues, self) : [];
  return issues
    .filter((i) => i.state === 'open' && kindOf(i) === 'taak')
    .filter((i) => !(self && matchesRef(self, i.ref)))
    .filter((i) => !chosen.some((ref) => matchesRef(i, ref)) && !blocked.includes(i))
    .filter((i) => {
      const text = `${normalise(i.title)} #${i.number ?? ''}`;
      return terms.every((t) => text.includes(t));
    })
    .map((i) => ({ ref: i.ref, title: i.title, number: i.number }))
    .sort((a, b) => a.title.localeCompare(b.title, 'nl'));
}
