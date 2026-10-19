import { soortenOverview, newSoort, deleteEffect } from './soort.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/store.js').ChangeResult} ChangeResult */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {ReturnType<typeof soortenOverview>[number]} SoortRow */

/**
 * The Soorten section of the Indeling tab: every Soort with its open Taken,
 * + Soort and Verwijderen. A Soort is a `soort:` label (Nexus ADR 0004), so
 * these change labels, which go straight to GitHub and are not queued: the
 * buttons are disabled while offline.
 *
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountSoorten({ getStore }) {
  /** @type {Issue[]} */
  let issues = [];
  /** @type {string[]} */
  let labels = [];
  let online = true;
  /** Set while a change is on its way to GitHub, so it isn't sent twice. */
  let busy = false;

  const dialog = /** @type {HTMLDialogElement} */ ($('soort-form'));
  const nameInput = /** @type {HTMLInputElement} */ ($('sf-name'));
  const formError = $('sf-error');

  $('s-add').addEventListener('click', openForm);
  $('sf-cancel').addEventListener('click', () => dialog.close());
  // Once sent, the sheet waits for GitHub's answer, which decides how it closes.
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  $('sf-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  function openForm() {
    nameInput.value = '';
    formError.hidden = true;
    dialog.showModal();
    nameInput.focus();
  }

  async function save() {
    const soort = newSoort(nameInput.value, labels, issues);
    if ('problem' in soort) {
      showFormError(soort.problem === 'empty' ? 'Geef de Soort een naam.' : `De Soort "${soort.soort}" bestaat al.`);
      nameInput.focus();
      return;
    }
    formError.hidden = true;
    const result = await change((store) => store.createLabel(soort.label));
    // Without a connection nothing happened; keep what was typed.
    if (result === 'offline') showFormError('Geen verbinding: de Soort is niet opgeslagen.');
    // A refusal shows the failure banner, which the sheet would cover.
    else if (result !== null) dialog.close();
  }

  /** @param {string} text */
  function showFormError(text) {
    formError.textContent = text;
    formError.hidden = false;
  }

  /** @param {SoortRow} row */
  async function remove(row) {
    if (!confirm(`Soort "${row.soort}" verwijderen? ${deleteEffect(row.open)} Dit kan niet ongedaan worden gemaakt.`)) return;
    // A Soort written by hand in two ways has two labels; both go.
    await change(async (store) => {
      /** @type {ChangeResult} */
      let result = 'saved';
      for (const label of row.labels) {
        result = await store.deleteLabel(label);
        if (result !== 'saved') break;
      }
      return result;
    });
  }

  /**
   * Sends one change, with the buttons disabled until GitHub answers. A
   * refusal is reported by the store's failure banner. Null when nothing was sent.
   * @param {(store: Store) => Promise<ChangeResult>} send
   * @returns {Promise<ChangeResult | null>}
   */
  async function change(send) {
    const store = getStore();
    if (!store || busy || !online) return null;
    busy = true;
    render();
    try {
      return await send(store);
    } finally {
      busy = false;
      render();
    }
  }

  function render() {
    const locked = busy || !online;
    for (const id of ['s-add', 'sf-save']) /** @type {HTMLButtonElement} */ ($(id)).disabled = locked;
    /** @type {HTMLButtonElement} */ ($('sf-cancel')).disabled = busy;
    // The Indeling notice is behind the sheet; say it in the sheet too.
    if (!online && dialog.open) showFormError('Geen verbinding: opslaan kan pas als je weer online bent.');
    const rows = soortenOverview(labels, issues);
    $('s-list').replaceChildren(...rows.map((row) => rowElement(row, locked, () => void remove(row))));
    $('s-empty').hidden = rows.length > 0;
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
 * One Soort: its name, its open Taken and Verwijderen.
 * @param {SoortRow} row @param {boolean} locked @param {() => void} onRemove
 */
function rowElement(row, locked, onRemove) {
  const li = el('li', 'soort-row');
  const remove = /** @type {HTMLButtonElement} */ (el('button', 'link soort-row__remove', 'Verwijderen'));
  remove.type = 'button';
  remove.disabled = locked;
  remove.setAttribute('aria-label', `Soort ${row.soort} verwijderen`);
  remove.addEventListener('click', onRemove);
  li.append(
    el('span', 'soort-row__name', row.soort),
    el('span', 'soort-row__count muted small', row.open === 1 ? '1 open Taak' : `${row.open} open Taken`),
    remove,
  );
  return li;
}
