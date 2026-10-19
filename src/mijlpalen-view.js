import { mijlpalenOverview, mijlpaalView } from './mijlpalen.js';
import { groupElement } from './taken-view.js';
import { parseMarkdown } from './markdown.js';
import { renderMarkdown } from './markdown-view.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {import('./mijlpalen.js').Progress} Progress */
/** @typedef {import('./data/store.js').MijlpaalResult} MijlpaalResult */
/** @typedef {ReturnType<import('./data/store.js').createStore>} Store */
/** @typedef {{ mijlpaal: number }} Screen */

/**
 * The Indeling tab in #panel-mijlpalen: its Mijlpalen section, and from there
 * a Mijlpaal's screen. That screen is its own history entry, so the phone's
 * back button goes back up.
 *
 * Creating, editing, Afronden, Heropenen and Verwijderen go straight to
 * GitHub and are not queued, so their buttons are disabled while offline.
 *
 * @param {{ getStore: () => Store | null, onOpen: (ref: IssueRef) => void, onClose: (issue: Issue) => void }} deps
 *   `onOpen` is called when a Taak is tapped; `onClose` when its checkbox is ticked.
 */
export function mountMijlpalen({ getStore, onOpen, onClose }) {
  /** @type {Issue[]} */
  let issues = [];
  /** @type {Milestone[]} */
  let milestones = [];
  let online = true;
  /** Set while a change is on its way to GitHub, so it isn't sent twice. */
  let busy = false;
  /** @type {Screen | null} null for the overview. */
  let screen = null;

  const dialog = /** @type {HTMLDialogElement} */ ($('mijlpaal-form'));
  const titleInput = /** @type {HTMLInputElement} */ ($('mf-title'));
  const descriptionInput = /** @type {HTMLTextAreaElement} */ ($('mf-description'));
  const formError = $('mf-error');
  /** @type {number | null} The Mijlpaal being edited; null for a new one. */
  let editing = null;

  $('m-back').addEventListener('click', () => history.back());
  $('m-add').addEventListener('click', () => openForm(null));
  $('m-edit').addEventListener('click', () => {
    const milestone = milestones.find((m) => m.number === screen?.mijlpaal);
    if (milestone) openForm(milestone);
  });
  $('m-afronden').addEventListener('click', () => setState('closed'));
  $('m-heropenen').addEventListener('click', () => setState('open'));
  $('m-delete').addEventListener('click', () => void remove());
  $('mf-cancel').addEventListener('click', () => dialog.close());
  $('mf-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  window.addEventListener('popstate', (event) => {
    // A Taak's detail screen has its own entries; the tab stays where it was.
    if (event.state?.detailRef !== undefined) return;
    show(event.state?.mijlpalen ?? null);
  });

  /** Goes a level down, as a step the back button undoes. @param {Screen} next */
  function open(next) {
    history.pushState({ mijlpalen: next }, '');
    show(next);
    window.scrollTo(0, 0);
  }

  /** @param {Screen | null} next */
  function show(next) {
    // A history entry from an older version may name a screen that is gone.
    screen = typeof next?.mijlpaal === 'number' ? next : null;
    render();
  }

  /** @param {Milestone | null} milestone null for a new one */
  function openForm(milestone) {
    editing = milestone?.number ?? null;
    $('mf-heading').textContent = milestone ? 'Mijlpaal bewerken' : 'Nieuwe Mijlpaal';
    titleInput.value = milestone?.title ?? '';
    descriptionInput.value = milestone?.description ?? '';
    formError.hidden = true;
    dialog.showModal();
    titleInput.focus();
  }

  async function save() {
    const title = titleInput.value.trim();
    if (title === '') {
      showFormError('Geef de Mijlpaal een naam.');
      titleInput.focus();
      return;
    }
    const description = descriptionInput.value.trim();
    const number = editing;
    const result = await change((store) =>
      number === null ? store.createMijlpaal({ title, description }) : store.editMijlpaal(number, { title, description }),
    );
    // Without a connection nothing happened; keep what was typed.
    if (result === 'offline') showFormError('Geen verbinding: de Mijlpaal is niet opgeslagen.');
    // A refusal shows the failure banner, which the sheet would cover.
    else if (result !== null) dialog.close();
  }

  /** @param {string} text */
  function showFormError(text) {
    formError.textContent = text;
    formError.hidden = false;
  }

  /** Afronden or Heropenen. @param {'open' | 'closed'} state */
  function setState(state) {
    const number = screen?.mijlpaal;
    if (number !== undefined) void change((store) => store.editMijlpaal(number, { state }));
  }

  async function remove() {
    const milestone = milestones.find((m) => m.number === screen?.mijlpaal);
    if (!milestone || !confirm(`Mijlpaal "${milestone.title}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    if ((await change((store) => store.deleteMijlpaal(milestone.number))) === 'saved') history.back();
  }

  /**
   * Sends one change, with the buttons disabled until GitHub answers. A
   * refusal is reported by the store's failure banner. Null when nothing was sent.
   * @param {(store: Store) => Promise<MijlpaalResult>} send
   * @returns {Promise<MijlpaalResult | null>}
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
    for (const id of ['m-add', 'm-edit', 'm-afronden', 'm-heropenen', 'm-delete', 'mf-save']) {
      /** @type {HTMLButtonElement} */ ($(id)).disabled = locked;
    }
    $('m-offline').hidden = online;
    $('m-overview').hidden = screen !== null;
    $('m-screen').hidden = screen === null;
    if (screen === null) renderOverview();
    else renderMijlpaal(screen.mijlpaal);
  }

  function renderOverview() {
    const { open: current, closed } = mijlpalenOverview(issues, milestones);
    const mijlpaalCard = (/** @type {import('./mijlpalen.js').MijlpaalSummary} */ m) =>
      card(m.title, m.progress, () => open({ mijlpaal: m.number }));
    $('m-open').replaceChildren(...current.map(mijlpaalCard));
    $('m-empty').hidden = current.length > 0;
    $('m-closed-list').replaceChildren(...closed.map(mijlpaalCard));
    $('m-closed-count').textContent = String(closed.length);
    $('m-closed').hidden = closed.length === 0;
  }

  /** @param {number} number */
  function renderMijlpaal(number) {
    const view = mijlpaalView(issues, milestones, number);
    $('m-title').textContent = view?.title ?? '';
    $('m-edit').hidden = view === null;
    $('m-screen-missing').hidden = view !== null;
    $('m-screen-body').hidden = view === null;
    if (!view) return;
    const afgerond = view.state === 'closed';
    $('m-afgerond').hidden = !afgerond;
    $('m-afronden').hidden = afgerond;
    $('m-heropenen').hidden = !afgerond;
    $('m-delete').hidden = !view.canDelete;
    $('m-progress').replaceChildren(progressBar(view.progress), el('span', 'muted small', countText(view.progress)));
    // Read-only: its checkboxes can't be ticked here.
    $('m-description').replaceChildren(renderMarkdown(parseMarkdown(view.description), null));
    $('m-description').hidden = view.description.trim() === '';
    $('m-taken').replaceChildren(...view.groups.map((g) => groupElement(g.soort, g.rows, onOpen, onClose, 'h3')));
    $('m-screen-empty').hidden = view.groups.length > 0;
  }

  render();

  return {
    /**
     * Redraws with the latest issues and Mijlpalen, and whether they can be changed now.
     * @param {Issue[]} nextIssues @param {Milestone[]} nextMilestones @param {boolean} nextOnline
     */
    update(nextIssues, nextMilestones, nextOnline) {
      issues = nextIssues;
      milestones = nextMilestones;
      online = nextOnline;
      render();
    },
  };
}

/**
 * A Mijlpaal to tap on, with its progress bar.
 * @param {string} title @param {Progress} progress @param {() => void} onTap
 */
function card(title, progress, onTap) {
  const li = el('li');
  const button = /** @type {HTMLButtonElement} */ (el('button', 'card'));
  button.type = 'button';
  const head = el('span', 'card__head');
  head.append(el('span', 'card__title', title), el('span', 'card__count muted', countText(progress)));
  button.append(head, progressBar(progress));
  button.addEventListener('click', onTap);
  li.append(button);
  return li;
}

/** @param {Progress} progress */
function progressBar(progress) {
  const bar = el('span', 'bar');
  // An empty one has no progress to announce; the count next to it says so.
  if (progress.total > 0) {
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(progress.total));
    bar.setAttribute('aria-valuenow', String(progress.closed));
    bar.setAttribute('aria-label', countText(progress));
  } else {
    bar.setAttribute('aria-hidden', 'true');
  }
  const fill = el('span', 'bar__fill');
  fill.style.width = progress.total === 0 ? '0%' : `${(100 * progress.closed) / progress.total}%`;
  bar.append(fill);
  return bar;
}

/** @param {Progress} progress */
function countText({ closed, total }) {
  return total === 0 ? 'nog leeg' : `${closed} van ${total} af`;
}
