import { plekkenOverview, plekDeleteEffect } from './boodschappen.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/store.js').ChangeResult} ChangeResult */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {ReturnType<typeof plekkenOverview>[number]} PlekRow */

/**
 * The Plekken section of the Indeling tab: every Plek with its open
 * Boodschappen, and Verwijderen. A Plek is a `waar:` label (Nexus ADR 0003);
 * deleting one goes straight to GitHub and is not queued, so the buttons are
 * disabled while offline. There is no way to add one here: a Plek is made by
 * typing it while editing a Boodschap.
 *
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountPlekken({ getStore }) {
  /** @type {Issue[]} */
  let issues = [];
  /** @type {string[]} */
  let labels = [];
  let online = true;
  /** Set while a deletion is on its way to GitHub, so it isn't sent twice. */
  let busy = false;

  /** @param {PlekRow} row */
  async function remove(row) {
    if (!confirm(`Plek "${row.plek}" verwijderen? ${plekDeleteEffect(row)} Dit kan niet ongedaan worden gemaakt.`)) return;
    const store = getStore();
    if (!store || busy || !online) return;
    busy = true;
    render();
    /** @type {ChangeResult} */
    let result = 'saved';
    try {
      // A Plek written by hand in two ways has two labels; both go. A refusal
      // is reported by the store's failure banner.
      for (const label of row.labels) {
        result = await store.deleteLabel(label);
        if (result !== 'saved') break;
      }
    } finally {
      busy = false;
      render();
    }
    // Its button is gone, and focus with it.
    if (result === 'saved') $('p-section-title').focus();
  }

  function render() {
    const locked = busy || !online;
    const rows = plekkenOverview(labels, issues);
    // The list is redrawn on every refresh; keep focus where it was, or on
    // the heading when the focused Plek was just deleted.
    const focused = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.plek;
    const list = $('p-list');
    list.replaceChildren(...rows.map((row) => rowElement(row, locked, () => void remove(row))));
    $('p-empty').hidden = rows.length > 0;
    if (focused === undefined) return;
    const same = [...list.querySelectorAll('button')].find((b) => b.dataset.plek === focused);
    (same ?? $('p-section-title')).focus();
  }

  render();

  return {
    /**
     * Redraws with the latest issues and labels, and whether they can be changed now.
     * @param {Issue[]} nextIssues @param {string[]} nextLabels @param {boolean} nextOnline
     */
    update(nextIssues, nextLabels, nextOnline) {
      issues = nextIssues;
      labels = nextLabels;
      online = nextOnline;
      render();
    },
  };
}

/**
 * One Plek: its name, its open Boodschappen and Verwijderen.
 * @param {PlekRow} row @param {boolean} locked @param {() => void} onRemove
 */
function rowElement(row, locked, onRemove) {
  const li = el('li', 'plek-row');
  const remove = /** @type {HTMLButtonElement} */ (el('button', 'link plek-row__remove', 'Verwijderen'));
  remove.type = 'button';
  remove.dataset.plek = row.plek;
  remove.disabled = locked;
  remove.setAttribute('aria-label', `Plek ${row.plek} verwijderen`);
  remove.addEventListener('click', onRemove);
  li.append(
    el('span', 'plek-row__name', row.plek),
    el('span', 'plek-row__count muted small', row.open === 1 ? '1 open Boodschap' : `${row.open} open Boodschappen`),
    remove,
  );
  return li;
}
