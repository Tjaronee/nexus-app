import { dutchDate, localDate, mapsUrl, pakkettenList, pakketDetails, pakketDraft, newPakketDraft, normaliseLocatie, savePakket } from './pakketten.js';
import { matchesRef } from './data/model.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {import('./pakketten.js').Item} Item */
/** @typedef {import('./pakketten.js').Draft} Draft */
/** @typedef {import('./pakketten.js').Problem} Problem */

/** @type {Record<Problem, string>} */
const PROBLEMS = {
  wat: 'Vul in wat er komt.',
  locatie: 'Vul in waar het heen gaat.',
  tracker: 'Een trackerlink begint met https://. Laat hem anders leeg.',
};

/**
 * The Pakketten tab in #panel-pakketten: the open Pakketten, each leading to
 * its tracker and its Locatie on the map. "Today", for what is overdue, is
 * this phone's date when the list is drawn. The + button and tapping a
 * Pakket open one sheet, to add or to edit one.
 * @param {{ getStore: () => Store | null, onBinnen: (issue: Issue) => void, onWeg: (issue: Issue) => void }} deps
 *   `onBinnen` closes a Pakket that arrived, `onWeg` one that won't come.
 */
export function mountPakketten({ getStore, onBinnen, onWeg }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('pakket'));
  const form = /** @type {HTMLFormElement} */ ($('pk-form'));
  const wat = /** @type {HTMLInputElement} */ ($('pk-wat'));
  const tracker = /** @type {HTMLInputElement} */ ($('pk-tracker'));
  const verwacht = /** @type {HTMLInputElement} */ ($('pk-verwacht'));
  const anders = /** @type {HTMLInputElement} */ ($('pk-anders'));
  const error = $('pk-error');
  /** The Pakket being edited, or null for a new one. @type {IssueRef | null} */
  let editing = null;
  /** Whether the Thuis chip is on, rather than Anders…. */
  let thuis = true;

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
    const title = /** @type {HTMLButtonElement} */ (el('button', 'pakket__title', item.issue.title));
    title.type = 'button';
    text.append(title);
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
      const link = /** @type {HTMLAnchorElement} */ (el('a', 'pakket__tracker', '↗'));
      link.href = item.tracker;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', `Volg ${item.issue.title}`);
      li.append(link);
    }
    // Anywhere on the line opens it, except the checkbox, ↗ and the map link.
    li.addEventListener('click', (event) => {
      if (!(/** @type {Element} */ (event.target).closest('.check, a'))) edit(item.issue.ref);
    });
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

  // The sheet

  /**
   * Opens the sheet for a new Pakket, at Thuis, with what it is filled in if
   * given (as when it comes from a Boodschap).
   * @param {{ wat?: string }} [prefill]
   */
  function openNew({ wat: what = '' } = {}) {
    if (!getStore()) return;
    editing = null;
    $('pk-sheet-title').textContent = 'Nieuw Pakket';
    $('pk-links').hidden = true;
    $('pk-weg').hidden = true;
    fill(newPakketDraft(what));
    dialog.showModal();
    // Still inside the tap, so phones open the keyboard.
    wat.focus();
  }

  /** @param {IssueRef} ref */
  function edit(ref) {
    const issue = getStore()?.getState().issues.find((i) => matchesRef(i, ref));
    if (!issue) return;
    editing = ref;
    $('pk-sheet-title').textContent = 'Pakket';
    const details = pakketDetails(issue.body);
    const open = /** @type {HTMLAnchorElement} */ ($('pk-open-tracker'));
    open.hidden = details.tracker === null;
    if (details.tracker) open.href = details.tracker;
    const map = /** @type {HTMLAnchorElement} */ ($('pk-kaart'));
    const url = details.locatie === null ? null : mapsUrl(details.locatie);
    map.hidden = url === null;
    if (url) map.href = url;
    $('pk-links').hidden = open.hidden && map.hidden;
    $('pk-weg').hidden = false;
    fill(pakketDraft(issue));
    dialog.showModal();
  }

  /** @param {Draft} draft */
  function fill(draft) {
    wat.value = draft.wat;
    tracker.value = draft.tracker;
    verwacht.value = draft.verwacht;
    // A Pakket without a Locatie is not at Thuis: Anders…, empty, until one is typed.
    thuis = draft.locatie !== '' && normaliseLocatie(draft.locatie) === 'Thuis';
    anders.value = thuis ? '' : draft.locatie;
    error.hidden = true;
    render();
  }

  function render() {
    $('pk-thuis').setAttribute('aria-pressed', String(thuis));
    $('pk-anders-chip').setAttribute('aria-pressed', String(!thuis));
    anders.hidden = thuis;
    $('pk-clear-date').hidden = verwacht.value === '';
  }

  /** @returns {Draft} */
  function read() {
    return { wat: wat.value, tracker: tracker.value, verwacht: verwacht.value, locatie: thuis ? 'Thuis' : anders.value };
  }

  $('add-pakket').addEventListener('click', () => openNew());
  $('pk-thuis').addEventListener('click', () => {
    thuis = true;
    error.hidden = true;
    render();
  });
  $('pk-anders-chip').addEventListener('click', () => {
    thuis = false;
    render();
    anders.focus();
  });
  verwacht.addEventListener('input', render);
  $('pk-clear-date').addEventListener('click', () => {
    verwacht.value = '';
    render();
  });
  for (const field of [wat, tracker, anders]) field.addEventListener('input', () => (error.hidden = true));

  // Where the browser can't read the clipboard, the link is pasted by hand.
  const paste = $('pk-paste');
  paste.hidden = !navigator.clipboard?.readText;
  paste.addEventListener('click', async () => {
    try {
      tracker.value = (await navigator.clipboard.readText()).trim();
      error.hidden = true;
    } catch {
      // Not allowed or nothing there: the field stays as it was.
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const store = getStore();
    if (!store) return;
    const saved = savePakket(store, editing, read());
    if ('ref' in saved) {
      dialog.close();
      return;
    }
    error.textContent = PROBLEMS[saved.problem];
    error.hidden = false;
    ({ wat, locatie: anders, tracker })[saved.problem].focus();
  });
  $('pk-cancel').addEventListener('click', () => dialog.close());
  $('pk-weg').addEventListener('click', () => {
    const issue = getStore()?.getState().issues.find((i) => editing !== null && matchesRef(i, editing));
    dialog.close();
    if (issue) onWeg(issue);
  });

  return { update, openNew };
}
