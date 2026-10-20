import { kindOf } from './data/model.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/**
 * What a Pakket's body says about it; each is null when its line is missing
 * or unreadable. `verwacht` is a date as YYYY-MM-DD.
 * @typedef {{ tracker: string | null, verwacht: string | null, locatie: string | null }} Details
 */
/** `overdue`: the Verwachte datum is before today. @typedef {Details & { issue: Issue, overdue: boolean }} Item */

const THUIS = 'thuis';
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
    tracker: /^https?:\/\/\S+$/i.test(lines.tracker ?? '') ? lines.tracker : null,
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
