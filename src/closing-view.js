import { addKennisbankLink } from './closing.js';
import { matchesRef } from './data/model.js';
import { $ } from './dom.js';

/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

const SNACKBAR_MS = 5000;

/**
 * Closing a Taak: it closes at once, then a snackbar offers to undo it or to
 * add its Kennisbank file. The same "Bestand toevoegen" sheet is also used
 * from the detail screen.
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountClosing({ getStore }) {
  const snackbar = $('snackbar');
  const dialog = /** @type {HTMLDialogElement} */ ($('kennisbank'));
  const form = /** @type {HTMLFormElement} */ ($('kennisbank-form'));
  const link = /** @type {HTMLInputElement} */ ($('kennisbank-link'));
  const error = $('kennisbank-error');

  /** The Taak the snackbar is about. @type {IssueRef | null} */
  let closed = null;
  /** The Taak the sheet adds a file to. @type {IssueRef | null} */
  let target = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function hideSnackbar() {
    clearTimeout(timer);
    snackbar.hidden = true;
    closed = null;
  }

  $('snackbar-undo').addEventListener('click', () => {
    if (closed !== null) getStore()?.reopen(closed);
    hideSnackbar();
  });
  $('snackbar-file').addEventListener('click', () => {
    const ref = closed;
    hideSnackbar();
    if (ref !== null) addFile(ref);
  });

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

  /**
   * Opens the sheet to paste a Kennisbank link for this Taak.
   * @param {IssueRef} ref
   */
  function addFile(ref) {
    const issue = getStore()?.getState().issues.find((i) => matchesRef(i, ref));
    target = ref;
    link.value = '';
    error.hidden = true;
    $('kennisbank-for').textContent = issue ? `Bij: ${issue.title}` : '';
    dialog.showModal();
    // Still inside the tap, so phones open the keyboard for pasting.
    link.focus();
  }

  return {
    /**
     * Closes the Taak as completed, without asking, and offers to undo it.
     * @param {IssueRef} ref @param {string} title
     */
    close(ref, title) {
      const store = getStore();
      if (!store) return;
      store.close(ref, 'completed');
      closed = ref;
      $('snackbar-text').textContent = `Afgerond: ${title}`;
      snackbar.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(hideSnackbar, SNACKBAR_MS);
    },
    addFile,
    /** For signing out: nothing about the previous user stays on screen. */
    hide() {
      hideSnackbar();
      if (dialog.open) dialog.close();
    },
  };
}
