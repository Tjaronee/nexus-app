import { $ } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

const SNACKBAR_MS = 5000;

/**
 * Closing a Taak: it closes at once, without asking, then a snackbar offers
 * for a few seconds to undo it or to add its Kennisbank file. Closing
 * another Taak meanwhile replaces the snackbar.
 * @param {{ getStore: () => Store | null, onAddFile: (ref: IssueRef) => void }} deps
 */
export function mountClosing({ getStore, onAddFile }) {
  const snackbar = $('snackbar');
  /** The Taak the snackbar is about. @type {IssueRef | null} */
  let closed = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function hide() {
    clearTimeout(timer);
    snackbar.hidden = true;
    closed = null;
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

  return {
    /** Closes the Taak as completed and offers to undo it. @param {Issue} issue */
    close(issue) {
      const store = getStore();
      if (!store) return;
      store.close(issue.ref, 'completed');
      closed = issue.ref;
      $('snackbar-text').textContent = `Afgerond: ${issue.title}`;
      snackbar.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(hide, SNACKBAR_MS);
    },
    hide,
  };
}
