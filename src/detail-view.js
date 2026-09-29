import { detailOf, blockerOptions, assigneeChange, editChoices } from './detail.js';
import { parseMarkdown, toggleTask } from './markdown.js';
import { renderMarkdown } from './markdown-view.js';
import { $, el, fillSelect, peopleCheckboxes } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

/**
 * The screen you get when you tap a Taak. Every edit goes straight to the
 * store; the screen redraws on each store change, except for a field that
 * is being typed in.
 *
 * It is a full-screen dialog with its own history entry, so the phone's
 * back button closes it (or goes back to the Taak opened before).
 *
 * @param {{ getStore: () => Store | null, getMe: () => string }} deps
 */
export function mountDetail({ getStore, getMe }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('detail'));
  const title = /** @type {HTMLTextAreaElement} */ ($('d-title'));
  const epic = /** @type {HTMLSelectElement} */ ($('d-epic'));
  const mijlpaal = /** @type {HTMLSelectElement} */ ($('d-mijlpaal'));
  const people = $('d-people');
  const bodyView = $('d-body');
  const bodyEditor = $('d-body-editor');
  const bodyText = /** @type {HTMLTextAreaElement} */ ($('d-body-text'));
  const blockerSearch = $('d-blocker-search');
  const blockerQuery = /** @type {HTMLInputElement} */ ($('d-blocker-query'));
  const copy = /** @type {HTMLButtonElement} */ ($('d-copy'));
  const chips = /** @type {NodeListOf<HTMLButtonElement>} */ (dialog.querySelectorAll('[data-d-prio], [data-d-urgentie]'));

  /** @type {IssueRef | null} */
  let ref = null;
  /** What the pickers offered at the last redraw; select values index into these. */
  /** @type {{ epics: { ref: IssueRef, title: string }[], mijlpalen: { number: number, title: string }[] }} */
  let offered = { epics: [], mijlpalen: [] };

  const current = () => {
    const store = getStore();
    return store && ref !== null ? detailOf(store.getState().issues, ref) : null;
  };

  /** Runs `change` against the store for the open Taak. @param {(store: Store, ref: IssueRef) => void} change */
  const edit = (change) => {
    const store = getStore();
    if (store && ref !== null) change(store, ref);
  };

  // Navigation

  $('d-back').addEventListener('click', () => history.back());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    history.back();
  });
  window.addEventListener('popstate', (event) => {
    const previous = event.state?.detailRef;
    // Signed out meanwhile: an old history entry must not reopen a Taak.
    if (previous !== undefined && getStore()) show(previous);
    else if (dialog.open) dialog.close();
  });

  /** Opens a Taak, as a new step the back button undoes. @param {IssueRef} next */
  function open(next) {
    history.pushState({ detailRef: next }, '');
    show(next);
  }

  /** @param {IssueRef} next */
  function show(next) {
    ref = next;
    bodyEditor.hidden = true;
    bodyView.hidden = false;
    blockerSearch.hidden = true;
    copy.textContent = 'Kopieer';
    if (!dialog.open) dialog.showModal();
    // The title is not focused, so the keyboard doesn't cover the screen.
    title.blur();
    dialog.scrollTop = 0;
    void getStore()?.loadComments(next).catch(() => {});
    render();
  }

  // Editing

  copy.addEventListener('click', async () => {
    const number = current()?.issue.number;
    if (!number) return;
    try {
      await navigator.clipboard.writeText(`#${number}`);
      copy.textContent = 'Gekopieerd';
    } catch {
      copy.textContent = 'Lukt niet';
    }
    setTimeout(() => (copy.textContent = 'Kopieer'), 1500);
  });

  $('d-reopen').addEventListener('click', () => edit((store, r) => store.reopen(r)));

  // The title is saved when you leave the field or press Enter.
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      title.blur();
    }
  });
  title.addEventListener('input', () => fitHeight(title));
  title.addEventListener('change', () => {
    const text = title.value.replace(/\s+/g, ' ').trim();
    const detail = current();
    if (!detail) return;
    if (text && text !== detail.issue.title) edit((store, r) => store.update(r, { title: text }));
    else title.value = detail.issue.title;
  });

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const detail = current();
      if (!detail) return;
      const { dPrio, dUrgentie } = /** @type {any} */ (chip.dataset);
      // Only a real change writes a label, so an unlabelled issue stays unlabelled.
      if (dPrio && dPrio !== detail.prio) edit((store, r) => store.setPrio(r, dPrio));
      if (dUrgentie && dUrgentie !== detail.urgentie) edit((store, r) => store.setUrgentie(r, dUrgentie));
    });
  }

  epic.addEventListener('change', () => {
    const chosen = epic.value === '' ? null : offered.epics[Number(epic.value)].ref;
    edit((store, r) => store.setParent(r, chosen));
  });
  mijlpaal.addEventListener('change', () => {
    const chosen = mijlpaal.value === '' ? null : offered.mijlpalen[Number(mijlpaal.value)].number;
    edit((store, r) => store.setMilestone(r, chosen));
  });
  people.addEventListener('change', () => {
    const detail = current();
    if (!detail) return;
    const chosen = [...people.querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value);
    const change = assigneeChange(detail.issue.assignees.map((a) => a.login), chosen);
    edit((store, r) => store.editAssignees(r, change));
  });

  $('d-edit-body').addEventListener('click', () => {
    bodyText.value = current()?.issue.body ?? '';
    bodyView.hidden = true;
    bodyEditor.hidden = false;
    bodyText.focus();
  });
  $('d-body-cancel').addEventListener('click', () => {
    bodyEditor.hidden = true;
    bodyView.hidden = false;
  });
  $('d-body-save').addEventListener('click', () => {
    if (bodyText.value !== current()?.issue.body) edit((store, r) => store.update(r, { body: bodyText.value }));
    bodyEditor.hidden = true;
    bodyView.hidden = false;
    render();
  });

  $('d-add-blocker').addEventListener('click', () => {
    blockerSearch.hidden = !blockerSearch.hidden;
    blockerQuery.value = '';
    renderBlockerOptions();
    if (!blockerSearch.hidden) blockerQuery.focus();
  });
  blockerQuery.addEventListener('input', renderBlockerOptions);

  // Drawing

  function render() {
    if (!dialog.open) return;
    const detail = current();
    $('d-missing').hidden = detail !== null;
    $('d-content').hidden = detail === null;
    $('d-number').textContent = detail?.issue.number ? `#${detail.issue.number}` : 'Nog niet op GitHub';
    copy.hidden = !detail?.issue.number;
    if (!detail) return;
    const { issue } = detail;

    $('d-closed').hidden = issue.state === 'open';
    if (document.activeElement !== title) {
      title.value = issue.title;
      fitHeight(title);
    }
    for (const chip of chips) {
      const { dPrio, dUrgentie } = chip.dataset;
      chip.setAttribute('aria-pressed', String(dPrio ? dPrio === detail.prio : dUrgentie === detail.urgentie));
    }
    renderPickers(issue);

    if (bodyEditor.hidden) {
      bodyView.replaceChildren(
        issue.body.trim()
          ? renderMarkdown(parseMarkdown(issue.body), (n) => edit((store, r) => store.update(r, { body: toggleTask(issue.body, n) })))
          : el('p', 'muted', 'Geen beschrijving.'),
      );
    }

    $('d-blocked').replaceChildren(
      ...detail.blockedBy.map((b) => {
        // One the app doesn't know has no screen to open; it can only be removed.
        const li = b.known ? refItem(b.ref, b.title, open) : el('li', undefined, b.title);
        if (!b.open) li.classList.add('done');
        const remove = /** @type {HTMLButtonElement} */ (el('button', 'remove', '×'));
        remove.type = 'button';
        remove.setAttribute('aria-label', `Niet meer Geblokkeerd door ${b.title}`);
        remove.addEventListener('click', () => edit((store, r) => store.removeBlockedBy(r, b.ref)));
        li.append(remove);
        return li;
      }),
    );
    if (!blockerSearch.hidden) renderBlockerOptions();
    $('d-blocking').replaceChildren(...detail.blocking.map((b) => refItem(b.ref, b.title, open)));
    $('d-blocking-section').hidden = detail.blocking.length === 0;

    const comments = getStore()?.comments(issue.ref) ?? [];
    $('d-comments').replaceChildren(...comments.map(commentItem));
    $('d-no-comments').hidden = comments.length > 0;
  }

  /** @param {Issue} issue */
  function renderPickers(issue) {
    const store = getStore();
    if (!store) return;
    const offer = editChoices(store.getState(), issue, getMe());
    offered = offer;
    if (document.activeElement !== epic) {
      fillSelect(epic, offer.epics, 'Geen Epic');
      epic.value = offer.epic < 0 ? '' : String(offer.epic);
    }
    if (document.activeElement !== mijlpaal) {
      fillSelect(mijlpaal, offer.mijlpalen, 'Geen Mijlpaal');
      mijlpaal.value = offer.mijlpaal < 0 ? '' : String(offer.mijlpaal);
    }
    people.replaceChildren(...peopleCheckboxes(offer.people, offer.toegewezen));
  }

  function renderBlockerOptions() {
    const store = getStore();
    const detail = current();
    if (!store || !detail) return;
    const options = blockerOptions(store.getState().issues, detail.issue, blockerQuery.value);
    $('d-blocker-options').replaceChildren(
      ...options.map((o) => {
        const button = /** @type {HTMLButtonElement} */ (el('button', 'option', o.title));
        button.type = 'button';
        if (o.number) button.append(el('span', 'muted', ` #${o.number}`));
        button.addEventListener('click', () => {
          blockerSearch.hidden = true;
          edit((store, r) => store.addBlockedBy(r, o.ref));
        });
        const li = el('li');
        li.append(button);
        return li;
      }),
    );
  }

  return { open, render };
}

/** @param {IssueRef} ref @param {string} title @param {(ref: IssueRef) => void} open */
function refItem(ref, title, open) {
  const li = el('li');
  const link = /** @type {HTMLButtonElement} */ (el('button', 'link', title));
  link.type = 'button';
  link.addEventListener('click', () => open(ref));
  li.append(link);
  return li;
}

/** @param {import('./data/store.js').Comment} comment */
function commentItem(comment) {
  const li = el('li', 'comment');
  const head = el('div', 'comment__head');
  head.append(
    el('span', 'comment__author', comment.author?.login ?? 'Jij'),
    el('span', 'muted', comment.pending ? ' · wordt verstuurd' : ` · ${formatDate(comment.createdAt)}`),
  );
  li.append(head, renderMarkdown(parseMarkdown(comment.body), null));
  return li;
}

/** @param {string} iso */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Grows a textarea to fit its text. @param {HTMLTextAreaElement} area */
function fitHeight(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}
