import { dutchDate, localDate, mapsUrl, pakkettenList } from './pakketten.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./pakketten.js').Item} Item */

/**
 * The Pakketten tab in #panel-pakketten: the open Pakketten, each leading to
 * its tracker and its Locatie on the map. "Today", for what is overdue, is
 * this phone's date when the list is drawn.
 * @param {{ onBinnen: (issue: Issue) => void }} deps `onBinnen` closes a Pakket that arrived.
 */
export function mountPakketten({ onBinnen }) {
  /** @param {Issue[]} issues */
  function update(issues) {
    const items = pakkettenList(issues, localDate());
    $('pk-list').replaceChildren(...items.map(row));
    $('pk-empty').hidden = items.length > 0;
  }

  /** @param {Item} item */
  function row(item) {
    const li = el('li', 'pakket');
    // Ticking closes the Pakket and the row goes, so it never shows as ticked.
    const check = /** @type {HTMLButtonElement} */ (el('button', 'check'));
    check.type = 'button';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', 'false');
    check.setAttribute('aria-label', `${item.issue.title} is binnen`);
    check.addEventListener('click', () => onBinnen(item.issue));

    const text = el('div', 'pakket__text');
    text.append(el('div', 'pakket__title', item.issue.title));
    const meta = el('div', 'pakket__meta');
    if (item.verwacht) {
      const date = el('span', item.overdue ? 'pakket__date pakket__date--overdue' : 'pakket__date', dutchDate(item.verwacht));
      if (item.overdue) date.title = 'Had er al moeten zijn';
      meta.append(date);
    }
    meta.append(locatie(item.locatie));
    text.append(meta);
    li.append(check, text);

    if (item.tracker) {
      const tracker = /** @type {HTMLAnchorElement} */ (el('a', 'pakket__tracker', '↗'));
      tracker.href = item.tracker;
      tracker.target = '_blank';
      tracker.rel = 'noopener';
      tracker.setAttribute('aria-label', `Volg ${item.issue.title}`);
      li.append(tracker);
    }
    return li;
  }

  /** 📍 and the Locatie, a link to the map except for Thuis. @param {string | null} name */
  function locatie(name) {
    const url = name === null ? null : mapsUrl(name);
    if (url === null) return el('span', 'pakket__locatie', `📍 ${name ?? 'Locatie onbekend'}`);
    const link = /** @type {HTMLAnchorElement} */ (el('a', 'pakket__locatie', `📍 ${name}`));
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  return { update };
}
