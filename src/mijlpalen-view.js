import { mijlpalenOverview, mijlpaalView, epicView } from './mijlpalen.js';
import { rowElement } from './taken-view.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {import('./mijlpalen.js').Progress} Progress */
/** @typedef {import('./mijlpalen.js').EpicSummary} EpicSummary */
/** @typedef {{ mijlpaal: number } | { epic: IssueRef }} Screen */

/**
 * The Mijlpalen tab in #panel-mijlpalen: the overview, and from there a
 * Mijlpaal's or an Epic's screen. Each screen is its own history entry, so
 * the phone's back button goes back up.
 *
 * @param {{ onOpen: (ref: IssueRef) => void, onClose: (issue: Issue) => void }} deps
 *   `onOpen` is called when a Taak is tapped; `onClose` when its checkbox is ticked.
 */
export function mountMijlpalen({ onOpen, onClose }) {
  /** @type {Issue[]} */
  let issues = [];
  /** @type {Milestone[]} */
  let milestones = [];
  /** @type {Screen | null} null for the overview. */
  let screen = null;

  $('m-back').addEventListener('click', () => history.back());
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
    screen = next;
    render();
  }

  function render() {
    $('m-overview').hidden = screen !== null;
    $('m-screen').hidden = screen === null;
    if (screen === null) renderOverview();
    else if ('mijlpaal' in screen) renderMijlpaal(screen.mijlpaal);
    else renderEpic(screen.epic);
  }

  function renderOverview() {
    const { open: current, closed, zonder } = mijlpalenOverview(issues, milestones);
    const mijlpaalCard = (/** @type {import('./mijlpalen.js').MijlpaalSummary} */ m) =>
      card(m.title, m.progress, false, () => open({ mijlpaal: m.number }));
    $('m-open').replaceChildren(...current.map(mijlpaalCard));
    $('m-empty').hidden = current.length > 0;
    $('m-zonder-list').replaceChildren(...zonder.map(epicCard));
    $('m-zonder').hidden = zonder.length === 0;
    $('m-closed-list').replaceChildren(...closed.map(mijlpaalCard));
    $('m-closed-count').textContent = String(closed.length);
    $('m-closed').hidden = closed.length === 0;
  }

  /** @param {number} number */
  function renderMijlpaal(number) {
    const view = mijlpaalView(issues, milestones, number);
    renderScreen(view, 'Deze Mijlpaal bestaat niet meer.', 'Geen open Taken in deze Mijlpaal.');
  }

  /** @param {IssueRef} ref */
  function renderEpic(ref) {
    const view = epicView(issues, ref);
    renderScreen(
      view && { title: view.issue.title, description: '', progress: view.progress, epics: view.epics, taken: view.taken },
      'Deze Epic bestaat niet meer.',
      'Geen open Taken in deze Epic.',
    );
  }

  /**
   * @param {{ title: string, description: string, progress: Progress, epics: EpicSummary[], taken: import('./taken.js').Row[] } | null} view
   * @param {string} missing what to say when it is gone
   * @param {string} empty what to say when there is nothing open in it
   */
  function renderScreen(view, missing, empty) {
    $('m-title').textContent = view?.title ?? '';
    $('m-screen-missing').textContent = missing;
    $('m-screen-missing').hidden = view !== null;
    $('m-screen-body').hidden = view === null;
    if (!view) return;
    $('m-progress').replaceChildren(progressBar(view.progress), el('span', 'muted small', countText(view.progress)));
    $('m-description').textContent = view.description;
    $('m-description').hidden = view.description.trim() === '';
    $('m-epics').replaceChildren(...view.epics.map(epicCard));
    $('m-epics-section').hidden = view.epics.length === 0;
    $('m-taken').replaceChildren(...view.taken.map((row) => rowElement(row, onOpen, onClose)));
    $('m-taken-section').hidden = view.taken.length === 0;
    $('m-screen-empty').textContent = empty;
    $('m-screen-empty').hidden = view.taken.length > 0;
  }

  /** @param {EpicSummary} e */
  function epicCard(e) {
    return card(e.issue.title, e.progress, e.issue.state === 'closed', () => open({ epic: e.issue.ref }));
  }

  render();

  return {
    /** Redraws with the latest issues and Mijlpalen. @param {Issue[]} nextIssues @param {Milestone[]} nextMilestones */
    update(nextIssues, nextMilestones) {
      issues = nextIssues;
      milestones = nextMilestones;
      render();
    },
  };
}

/**
 * A Mijlpaal or Epic to tap on, with its progress bar.
 * @param {string} title @param {Progress} progress @param {boolean} done @param {() => void} onTap
 */
function card(title, progress, done, onTap) {
  const li = el('li');
  const button = /** @type {HTMLButtonElement} */ (el('button', done ? 'card card--done' : 'card'));
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
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(progress.total));
  bar.setAttribute('aria-valuenow', String(progress.closed));
  bar.setAttribute('aria-label', countText(progress));
  const fill = el('span', 'bar__fill');
  fill.style.width = progress.total === 0 ? '0%' : `${(100 * progress.closed) / progress.total}%`;
  bar.append(fill);
  return bar;
}

/** @param {Progress} progress */
function countText({ closed, total }) {
  return total === 0 ? 'nog leeg' : `${closed} van ${total} af`;
}
