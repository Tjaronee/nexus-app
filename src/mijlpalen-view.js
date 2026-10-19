import { mijlpalenOverview, mijlpaalView } from './mijlpalen.js';
import { rowElement } from './taken-view.js';
import { parseMarkdown } from './markdown.js';
import { renderMarkdown } from './markdown-view.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./data/store.js').Milestone} Milestone */
/** @typedef {import('./mijlpalen.js').Progress} Progress */
/** @typedef {{ mijlpaal: number }} Screen */

/**
 * The Mijlpalen tab in #panel-mijlpalen: the overview, and from there a
 * Mijlpaal's screen. That screen is its own history entry, so the phone's
 * back button goes back up.
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
    // A history entry from an older version may name a screen that is gone.
    screen = typeof next?.mijlpaal === 'number' ? next : null;
    render();
  }

  function render() {
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
    $('m-screen-missing').textContent = 'Deze Mijlpaal bestaat niet meer.';
    $('m-screen-missing').hidden = view !== null;
    $('m-screen-body').hidden = view === null;
    if (!view) return;
    $('m-progress').replaceChildren(progressBar(view.progress), el('span', 'muted small', countText(view.progress)));
    // Read-only: its checkboxes can't be ticked here.
    $('m-description').replaceChildren(renderMarkdown(parseMarkdown(view.description), null));
    $('m-description').hidden = view.description.trim() === '';
    $('m-taken').replaceChildren(...view.taken.map((row) => rowElement(row, onOpen, onClose)));
    $('m-taken-section').hidden = view.taken.length === 0;
    $('m-screen-empty').textContent = 'Geen open Taken in deze Mijlpaal.';
    $('m-screen-empty').hidden = view.taken.length > 0;
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
