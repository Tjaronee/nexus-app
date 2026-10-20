import { kindOf, matchesRef, PAKKET_LABEL } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/**
 * What a Pakket's body says about it; each is null when its line is missing
 * or unreadable. `verwacht` is a date as YYYY-MM-DD.
 * @typedef {{ tracker: string | null, verwacht: string | null, locatie: string | null }} Details
 */
/** `overdue`: the Verwachte datum is before today. @typedef {Details & { issue: Issue, overdue: boolean }} Item */
/**
 * What the Pakket sheet has filled in, as typed. `verwacht` is YYYY-MM-DD or
 * empty; `locatie` is "Thuis" when that chip is on, else the Anders… text.
 * @typedef {{ wat: string, tracker: string, verwacht: string, locatie: string }} Draft
 */
/** Why a Draft can't be saved: no Wat, no Locatie, or a tracker that isn't a web link. @typedef {'wat' | 'locatie' | 'tracker'} Problem */

const THUIS = 'thuis';
/** The body lines the app writes, in this order (Nexus ADR 0005). */
const LINES = /** @type {const} */ ([['tracker', 'Tracker'], ['verwacht', 'Verwacht'], ['locatie', 'Locatie']]);
const KNOWN_LINE = /^\s*(tracker|verwacht|locatie)\s*:/i;
const WEB_LINK = /^https?:\/\/\S+$/i;
const WEEKDAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * Reads the `Tracker:`, `Verwacht:` and `Locatie:` lines of a Pakket's body
 * (Nexus ADR 0005). Leniently, as it may be written by hand on github.com:
 * keys ignore case and spaces, the first of each counts, other text is
 * ignored. A tracker must be a web link, and a date a real one.
 * @param {string} body without the cid marker
 * @returns {Details}
 */
export function pakketDetails(body) {
  /** @type {Record<string, string>} */
  const lines = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*(\w+)\s*:(.*)$/);
    const key = match?.[1].toLowerCase();
    if (match && key && !(key in lines)) lines[key] = match[2].trim();
  }
  return {
    tracker: WEB_LINK.test(lines.tracker ?? '') ? lines.tracker : null,
    verwacht: isDate(lines.verwacht ?? '') ? lines.verwacht : null,
    locatie: lines.locatie || null,
  };
}

/**
 * The Pakketten tab: every open Pakket, flat, by Verwachte datum (undated
 * last), then Locatie (Thuis first, unknown last), then title.
 * @param {Issue[]} issues
 * @param {string} today this phone's date as YYYY-MM-DD; a Pakket expected today is not overdue
 * @returns {Item[]}
 */
export function pakkettenList(issues, today) {
  return issues
    .filter((i) => i.state === 'open' && kindOf(i) === 'pakket')
    .map((issue) => {
      const details = pakketDetails(issue.body);
      return { issue, ...details, overdue: details.verwacht !== null && details.verwacht < today };
    })
    .sort((a, b) => byDate(a.verwacht, b.verwacht) || byLocatie(a.locatie, b.locatie) || a.issue.title.localeCompare(b.issue.title, 'nl'));
}

/** A date the Dutch short way, as "do 23 okt". @param {string} date YYYY-MM-DD */
export function dutchDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

/** The calendar date on this phone, as YYYY-MM-DD. @param {Date} [now] */
export function localDate(now = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Where to look a Locatie up on Google Maps; null for Thuis, which needs no map.
 * @param {string} locatie
 */
export function mapsUrl(locatie) {
  if (isThuis(locatie)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locatie)}`;
}

/**
 * Writes a Pakket's details into its body: the `Tracker:`, `Verwacht:` and
 * `Locatie:` lines, in that order, where the first of them was (else under
 * the other text). A detail that is null has no line. Every other line stays
 * as it was, and any other line with one of these keys goes, so what is
 * written is what is read back.
 * @param {string} body without the cid marker
 * @param {Details} details
 */
export function pakketBody(body, details) {
  const written = LINES.flatMap(([key, name]) => (details[key] ? [`${name}: ${details[key]}`] : []));
  const lines = body.split(/\r?\n/);
  const first = lines.findIndex((line) => KNOWN_LINE.test(line));
  if (first === -1) return [body.trim(), written.join('\n')].filter(Boolean).join('\n\n');
  const kept = lines.flatMap((line, i) => (i === first ? written : KNOWN_LINE.test(line) ? [] : [line]));
  return kept.join('\n').trim();
}

/**
 * How a Locatie is written: spaces tidied, and Thuis however it was typed.
 * @param {string} text
 */
export function normaliseLocatie(text) {
  const locatie = text.replace(/\s+/g, ' ').trim();
  return isThuis(locatie) ? 'Thuis' : locatie;
}

/**
 * Why the sheet can't be saved yet, or null when it can. A Locatie is
 * required: empty does not mean Thuis.
 * @param {Draft} draft
 * @returns {Problem | null}
 */
export function pakketProblem(draft) {
  if (!draft.wat.trim()) return 'wat';
  if (!normaliseLocatie(draft.locatie)) return 'locatie';
  const tracker = draft.tracker.trim();
  if (tracker && !WEB_LINK.test(tracker)) return 'tracker';
  return null;
}

/**
 * The sheet filled in from a Pakket: what the app can read of it, empty
 * where it can't.
 * @param {Issue} issue
 * @returns {Draft}
 */
export function pakketDraft(issue) {
  const { tracker, verwacht, locatie } = pakketDetails(issue.body);
  return { wat: issue.title, tracker: tracker ?? '', verwacht: verwacht ?? '', locatie: locatie ?? '' };
}

/**
 * The sheet for a new Pakket: at Thuis, with what it is filled in if given,
 * as when it comes from a ticked Boodschap. Only the name is taken over, so
 * the Pakket has no link to the Boodschap.
 * @param {string} [wat]
 * @returns {Draft}
 */
export function newPakketDraft(wat = '') {
  return { wat, tracker: '', verwacht: '', locatie: 'Thuis' };
}

/**
 * Saves the sheet: a new Pakket when `ref` is null, else an edit of that one
 * that sends only what changed. The body is only rewritten when the details
 * differ from what it says, so renaming a Pakket keeps lines written by hand
 * that the app can't read. Saves nothing when there is a Problem.
 * @param {Store} store
 * @param {IssueRef | null} ref
 * @param {Draft} draft
 * @returns {{ ref: IssueRef } | { problem: Problem }}
 */
export function savePakket(store, ref, draft) {
  const problem = pakketProblem(draft);
  if (problem) return { problem };
  const title = draft.wat.replace(/\s+/g, ' ').trim();
  /** @type {Details} */
  const details = {
    tracker: draft.tracker.trim() || null,
    verwacht: isDate(draft.verwacht) ? draft.verwacht : null,
    locatie: normaliseLocatie(draft.locatie),
  };
  if (ref === null) return { ref: store.create({ title, body: pakketBody('', details), labels: [PAKKET_LABEL] }) };

  const issue = store.getState().issues.find((i) => matchesRef(i, ref));
  if (!issue) return { ref };
  /** @type {{ title?: string, body?: string }} */
  const fields = {};
  if (title !== issue.title) fields.title = title;
  const current = pakketDetails(issue.body);
  if (LINES.some(([key]) => current[key] !== details[key])) fields.body = pakketBody(issue.body, details);
  if (Object.keys(fields).length > 0) store.update(ref, fields);
  return { ref };
}

/** @param {string} locatie */
function isThuis(locatie) {
  return locatie.trim().toLowerCase() === THUIS;
}

/** Whether this is YYYY-MM-DD and that day exists. @param {string} text */
function isDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Soonest first, undated last. YYYY-MM-DD sorts as text. @param {string | null} a @param {string | null} b */
function byDate(a, b) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Thuis first, however it is written, then alphabetical, unknown last. @param {string | null} a @param {string | null} b */
function byLocatie(a, b) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  if (isThuis(a) || isThuis(b)) return Number(isThuis(b)) - Number(isThuis(a));
  return a.localeCompare(b, 'nl');
}
