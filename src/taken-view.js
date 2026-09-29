import { takenList, loadFilters, saveFilters, isFiltered } from './taken.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./taken.js').Filters} Filters */
/** @typedef {import('./taken.js').Row} Row */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * The Taken list in #panel-taken. The controls are static in index.html, so
 * typing in the search box never loses focus; only the lists are redrawn.
 *
 * @param {{ storage: Storage, onOpen: (ref: IssueRef) => void }} deps
 *   `onOpen` is called when a blocking Taak is tapped.
 */
export function mountTaken({ storage, onOpen }) {
  let filters = loadFilters(storage);
  let search = '';
  /** @type {Issue[]} */
  let issues = [];
  let me = '';

  const panel = $('panel-taken');
  const searchInput = /** @type {HTMLInputElement} */ ($('taken-search'));
  const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (panel.querySelectorAll('[data-wie], [data-prio], [data-urgentie]'));

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    render();
  });
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const { wie, prio, urgentie } = /** @type {any} */ (button.dataset);
      if (wie) setFilters({ ...filters, wie });
      if (prio) setFilters({ ...filters, prio: toggle(filters.prio, prio) });
      if (urgentie) setFilters({ ...filters, urgentie: toggle(filters.urgentie, urgentie) });
    });
  }

  /** Whether a filter button is on. @param {HTMLButtonElement} button */
  function pressed(button) {
    const { wie, prio, urgentie } = /** @type {any} */ (button.dataset);
    if (wie) return wie === filters.wie;
    return prio ? filters.prio.includes(prio) : filters.urgentie.includes(urgentie);
  }

  /** @param {Filters} next */
  function setFilters(next) {
    filters = next;
    saveFilters(storage, filters);
    render();
  }

  function render() {
    for (const button of buttons) button.setAttribute('aria-pressed', String(pressed(button)));

    const { free, blocked } = takenList(issues, { filters, search, me });
    $('taken-list').replaceChildren(...free.map((row) => rowElement(row, onOpen)));
    $('taken-blocked-list').replaceChildren(...blocked.map((row) => rowElement(row, onOpen)));
    $('taken-blocked').hidden = blocked.length === 0;

    const empty = $('taken-empty');
    empty.textContent = search.trim() !== '' || isFiltered(filters) ? 'Geen Taken die hierbij passen.' : 'Geen open Taken.';
    empty.hidden = free.length + blocked.length > 0;
  }

  render();

  return {
    /**
     * Redraws with the latest issues. `me` is the signed-in login.
     * @param {Issue[]} nextIssues @param {string} nextMe
     */
    update(nextIssues, nextMe) {
      issues = nextIssues;
      me = nextMe;
      render();
    },
    /**
     * Scrolls to a Taak's row and highlights it. False when it isn't in the list.
     * @param {IssueRef} ref
     */
    reveal(ref) {
      const row = /** @type {HTMLElement | null} */ (panel.querySelector(`[data-ref="${CSS.escape(String(ref))}"]`));
      if (!row) return false;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('flash');
      void row.offsetWidth; // Restart the animation when tapped twice.
      row.classList.add('flash');
      return true;
    },
  };
}

/**
 * @template T
 * @param {T[]} list @param {T} value
 */
function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** @param {Row} row @param {(ref: IssueRef) => void} onOpen */
function rowElement(row, onOpen) {
  const li = el('li', 'taak');
  li.dataset.ref = String(row.issue.ref);

  const head = el('div', 'taak__head');
  head.append(el('span', 'taak__title', row.issue.title));
  if (row.issue.assignees.length > 0) {
    const avatars = el('span', 'taak__avatars');
    for (const person of row.issue.assignees) {
      const img = /** @type {HTMLImageElement} */ (el('img'));
      img.src = person.avatarUrl;
      img.alt = person.login;
      img.title = person.login;
      img.width = img.height = 24;
      avatars.append(img);
    }
    head.append(avatars);
  }
  li.append(head);

  const meta = el('div', 'taak__meta');
  meta.append(
    badge(`prio-${row.prio}`, row.prio, `Prio: ${row.prio}`),
    badge(`urgentie-${row.urgentie}`, row.urgentie, `Urgentie: ${row.urgentie}`),
  );
  if (row.breadcrumb.length > 0) meta.append(el('span', 'taak__crumb', `📁 ${row.breadcrumb.join(' · ')}`));
  li.append(meta);

  for (const blocker of row.waitingFor) {
    const wait = el('div', 'taak__wait', '⛔ wacht op: ');
    const link = /** @type {HTMLButtonElement} */ (el('button', 'link', blocker.title));
    link.type = 'button';
    link.addEventListener('click', () => onOpen(blocker.ref));
    wait.append(link);
    li.append(wait);
  }
  return li;
}

/** @param {string} kind @param {string} text @param {string} label */
function badge(kind, text, label) {
  const span = el('span', `badge badge--${kind}`, text);
  span.setAttribute('aria-label', label);
  return span;
}

/** @param {string} tag @param {string} [className] @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
