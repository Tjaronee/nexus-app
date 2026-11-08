import { $ } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

const SNACKBAR_MS = 5000;

/**
 * Closing a Taak: it closes at once, without asking, then a snackbar offers
 * for a few seconds to undo it or to add its Kennisbank file. Closing
 * another Taak meanwhile replaces the snackbar. Removing a Boodschap and
 * marking a Pakket Binnen or Weg work the same way, without the file.
 * Ticking a Boodschap does too, and offers + Pakket instead of the file.
 * @param {{ getStore: () => Store | null, onAddFile: (ref: IssueRef) => void, onNewPakket: (wat: string) => void }} deps
 *   `onNewPakket` opens the sheet for a new Pakket with Wat filled in.
 */
export function mountClosing({ getStore, onAddFile, onNewPakket }) {
  const snackbar = $('snackbar');
  /** The Taak, Boodschap or Pakket the snackbar is about. @type {IssueRef | null} */
  let closed = null;
  /** The name of the Boodschap just ticked, while + Pakket is offered. @type {string | null} */
  let bought = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function hide() {
    clearTimeout(timer);
    snackbar.hidden = true;
    closed = null;
    bought = null;
  }

  /**
   * Shows the snackbar with only the given actions, for a few seconds.
   * @param {string} text
   * @param {{ undo?: boolean, file?: boolean, pakket?: boolean }} actions
   */
  function show(text, { undo = false, file = false, pakket = false }) {
    $('snackbar-text').textContent = text;
    $('snackbar-undo').hidden = !undo;
    $('snackbar-file').hidden = !file;
    $('snackbar-pakket').hidden = !pakket;
    snackbar.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, SNACKBAR_MS);
  }

  $('snackbar-undo').addEventListener('click', () => {
    if (closed !== null) getStore()?.reopen(closed);
    hide();
  });
  $('snackbar-file').addEventListener('click', () => {
    const ref = closed;
    hide();
    if (ref !== null) onAddFile(ref);
  });
  $('snackbar-pakket').addEventListener('click', () => {
    const wat = bought;
    hide();
    if (wat !== null) onNewPakket(wat);
  });

  /**
   * @param {Issue} issue
   * @param {'completed' | 'not_planned'} reason
   * @param {string} text
   * @param {{ file?: boolean, pakket?: boolean }} [offer]
   */
  function closeWithUndo(issue, reason, text, { file = false, pakket = false } = {}) {
    const store = getStore();
    if (!store) return;
    store.close(issue.ref, reason);
    closed = issue.ref;
    bought = pakket ? issue.title : null;
    // A Kennisbank file belongs to a Taak that got done, not to a Boodschap or Pakket.
    show(text, { undo: true, file, pakket });
  }

  return {
    /** Closes the Taak as completed and offers to undo it. @param {Issue} issue */
    close: (issue) => closeWithUndo(issue, 'completed', `Afgerond: ${issue.title}`, { file: true }),
    /** Removes a Boodschap that is no longer needed, and offers to undo it. @param {Issue} issue */
    remove: (issue) => closeWithUndo(issue, 'not_planned', `Verwijderd: ${issue.title}`),
    /** Marks a Pakket Binnen (closed as completed), and offers to undo it. @param {Issue} issue */
    binnen: (issue) => closeWithUndo(issue, 'completed', `Binnen: ${issue.title}`),
    /** Marks a Pakket Weg, as it won't come (closed as not planned), and offers to undo it. @param {Issue} issue */
    weg: (issue) => closeWithUndo(issue, 'not_planned', `Weg: ${issue.title}`),
    /**
     * Ticks a Boodschap (closed as completed), and offers to undo it or to add
     * it as a Pakket, in case it was ordered online.
     * @param {Issue} issue
     */
    tick: (issue) => closeWithUndo(issue, 'completed', `Gekocht: ${issue.title}`, { pakket: true }),
    hide,
  };
}
