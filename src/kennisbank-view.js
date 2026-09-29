import { addKennisbankLink } from './kennisbank.js';
import { matchesRef } from './data/model.js';
import { $ } from './dom.js';

/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

/**
 * The "📎 Bestand toevoegen" sheet: paste a Kennisbank link and it is posted
 * as a comment on the Taak. Opened from the snackbar after closing a Taak,
 * and from the detail screen.
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountKennisbank({ getStore }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('kennisbank'));
  const form = /** @type {HTMLFormElement} */ ($('kennisbank-form'));
  const link = /** @type {HTMLInputElement} */ ($('kennisbank-link'));
  const error = $('kennisbank-error');
  /** The Taak the link is for. @type {IssueRef | null} */
  let target = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const store = getStore();
    if (!store || target === null) return;
    if (addKennisbankLink(store, target, link.value)) dialog.close();
    else error.hidden = false;
  });
  link.addEventListener('input', () => {
    error.hidden = true;
  });
  $('kennisbank-cancel').addEventListener('click', () => dialog.close());

  return {
    /**
     * Opens the sheet for this Taak.
     * @param {IssueRef} ref
     */
    addFile(ref) {
      const issue = getStore()?.getState().issues.find((i) => matchesRef(i, ref));
      target = ref;
      link.value = '';
      error.hidden = true;
      $('kennisbank-for').textContent = issue ? `Bij: ${issue.title}` : '';
      dialog.showModal();
      // Still inside the tap, so phones open the keyboard for pasting.
      link.focus();
    },
  };
}
