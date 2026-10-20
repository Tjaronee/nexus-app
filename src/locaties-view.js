import { savedLocaties, locatieChange } from './locaties.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/store.js').ChangeResult} ChangeResult */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {import('./locaties.js').Locatie} Locatie */
/** @typedef {import('./locaties.js').LocatieChange} LocatieChange */

/**
 * The Locaties section of the Indeling tab: Thuis and the saved Locaties
 * with their addresses, + Locatie, Bewerken and Verwijderen. A saved Locatie
 * is a `locatie:` label with its address as the description (Nexus ADR 0005),
 * so these change labels, which go straight to GitHub and are not queued:
 * the buttons are disabled while offline. Pakketten hold a Locatie as text,
 * so renaming or deleting one leaves them as they are.
 *
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountLocaties({ getStore }) {
  /** @type {string[]} */
  let labels = [];
  /** @type {Record<string, string>} */
  let descriptions = {};
  let online = true;
  /** Set while a change is on its way to GitHub, so it isn't sent twice. */
  let busy = false;
  /** The Locatie the form edits, or null for a new one. @type {Locatie | null} */
  let editing = null;

  const dialog = /** @type {HTMLDialogElement} */ ($('locatie-form'));
  const nameInput = /** @type {HTMLInputElement} */ ($('lf-name'));
  const adresInput = /** @type {HTMLInputElement} */ ($('lf-adres'));
  const formError = $('lf-error');

  $('l-add').addEventListener('click', () => openForm(null));
  $('lf-cancel').addEventListener('click', () => dialog.close());
  // Once sent, the sheet waits for GitHub's answer, which decides how it closes.
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  // The button that opened the sheet may have been redrawn meanwhile; go back to the new one.
  dialog.addEventListener('close', () => {
    const key = editing?.key;
    const edit = [...$('l-list').querySelectorAll('button')].find((b) => b.dataset.locatie === key && b.dataset.action === 'edit');
    (edit ?? $('l-add')).focus();
  });
  $('lf-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  /** @param {Locatie | null} row */
  function openForm(row) {
    editing = row;
    const thuis = row?.key === 'thuis';
    $('lf-heading').textContent = row === null ? 'Nieuwe Locatie' : thuis ? 'Thuis' : 'Locatie bewerken';
    // Thuis keeps its name: only its address can change.
    nameInput.hidden = thuis;
    nameInput.value = row?.locatie ?? '';
    adresInput.value = row?.adres ?? '';
    formError.hidden = true;
    render();
    dialog.showModal();
    (thuis ? adresInput : nameInput).focus();
  }

  async function save() {
    const change = locatieChange(editing, { naam: nameInput.value, adres: adresInput.value }, locaties());
    if (change === null) {
      dialog.close();
      return;
    }
    if ('problem' in change) {
      showFormError(
        change.problem === 'bestaat'
          ? `De Locatie "${change.locatie}" bestaat al.`
          : change.problem === 'naam'
            ? 'Geef de Locatie een naam.'
            : 'Een adres is hoogstens 100 tekens.',
      );
      (change.problem === 'adres' ? adresInput : nameInput).focus();
      return;
    }
    formError.hidden = true;
    const result = await send((store) => {
      if ('create' in change) return store.createLabel(change.create.name, change.create.description);
      const { label, ...fields } = change.edit;
      return store.editLabel(label, fields);
    });
    // Without a connection nothing happened; keep what was typed.
    if (result === 'offline') showFormError('Geen verbinding: de Locatie is niet opgeslagen.');
    // A refusal shows the failure banner, which the sheet would cover.
    else if (result !== null) dialog.close();
  }

  /** @param {string} text */
  function showFormError(text) {
    formError.textContent = text;
    formError.hidden = false;
  }

  /** @param {Locatie} row */
  async function remove(row) {
    if (!confirm(`Locatie "${row.locatie}" verwijderen? Pakketten die erheen gaan houden hun Locatie. Dit kan niet ongedaan worden gemaakt.`)) return;
    // A Locatie written by hand in two ways has two labels; both go.
    const result = await send(async (store) => {
      /** @type {ChangeResult} */
      let result = 'saved';
      for (const label of row.labels) {
        result = await store.deleteLabel(label);
        if (result !== 'saved') break;
      }
      return result;
    });
    // Its buttons are gone, and focus with them.
    if (result === 'saved') $('l-add').focus();
  }

  /**
   * Sends one change, with the buttons disabled until GitHub answers. A
   * refusal is reported by the store's failure banner. Null when nothing was sent.
   * @param {(store: Store) => Promise<ChangeResult>} change
   * @returns {Promise<ChangeResult | null>}
   */
  async function send(change) {
    const store = getStore();
    if (!store || busy || !online) return null;
    busy = true;
    render();
    try {
      return await change(store);
    } finally {
      busy = false;
      render();
    }
  }

  const locaties = () => savedLocaties(labels, descriptions);

  function render() {
    const locked = busy || !online;
    for (const id of ['l-add', 'lf-save']) /** @type {HTMLButtonElement} */ ($(id)).disabled = locked;
    /** @type {HTMLButtonElement} */ ($('lf-cancel')).disabled = busy;
    // The Indeling notice is behind the sheet; say it in the sheet too.
    if (!online && dialog.open) showFormError('Geen verbinding: opslaan kan pas als je weer online bent.');
    // The list is redrawn on every refresh; keep focus where it was, or on
    // + Locatie when the focused Locatie was just deleted or renamed.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const focused = active?.dataset?.locatie === undefined ? undefined : `${active.dataset.locatie} ${active.dataset.action}`;
    const list = $('l-list');
    list.replaceChildren(
      ...locaties().map((row) => rowElement(row, locked, () => openForm(row), () => void remove(row))),
    );
    if (focused === undefined) return;
    const same = [...list.querySelectorAll('button')].find((b) => `${b.dataset.locatie} ${b.dataset.action}` === focused);
    (same ?? $('l-add')).focus();
  }

  render();

  return {
    /**
     * Redraws with the latest labels and their descriptions, and whether they can be changed now.
     * @param {string[]} nextLabels @param {Record<string, string>} nextDescriptions @param {boolean} nextOnline
     */
    update(nextLabels, nextDescriptions, nextOnline) {
      labels = nextLabels;
      descriptions = nextDescriptions;
      online = nextOnline;
      render();
    },
  };
}

/**
 * One Locatie: its name, its address if it has one, Bewerken, and
 * Verwijderen except for Thuis.
 * @param {Locatie} row @param {boolean} locked @param {() => void} onEdit @param {() => void} onRemove
 */
function rowElement(row, locked, onEdit, onRemove) {
  const li = el('li', 'locatie-row');
  const text = el('div', 'locatie-row__text');
  text.append(el('div', 'locatie-row__name', row.locatie));
  if (row.adres) text.append(el('div', 'locatie-row__adres muted small', row.adres));
  li.append(text, button('Bewerken', 'edit', `Locatie ${row.locatie} bewerken`, onEdit));
  if (row.key !== 'thuis') li.append(button('Verwijderen', 'remove', `Locatie ${row.locatie} verwijderen`, onRemove));
  return li;

  /** @param {string} label @param {'edit' | 'remove'} action @param {string} ariaLabel @param {() => void} onClick */
  function button(label, action, ariaLabel, onClick) {
    const b = /** @type {HTMLButtonElement} */ (el('button', `link locatie-row__${action}`, label));
    b.type = 'button';
    b.dataset.locatie = row.key;
    b.dataset.action = action;
    b.disabled = locked;
    b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
  }
}
