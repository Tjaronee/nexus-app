import { takenList, loadFilters, saveFilters, ALL } from './taken.js';

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
  const wieButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (panel.querySelectorAll('[data-wie]'));
  const prioChips = /** @type {NodeListOf<HTMLButtonElement>} */ (panel.querySelectorAll('[data-prio]'));
  const urgentieChips = /** @type {NodeListOf<HTMLButtonElement>} */ (panel.querySelectorAll('[data-urgentie]'));

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    render();
  });
  for (const button of wieButtons) {
    button.addEventListener('click', () => setFilters({ ...filters, wie: /** @type {any} */ (button.dataset.wie) }));
  }
  for (const chip of prioChips) {
    chip.addEventListener('click', () => setFilters({ ...filters, prio: toggle(filters.prio, /** @type {any} */ (chip.dataset.prio)) }));
  }
  for (const chip of urgentieChips) {
    chip.addEventListener('click', () =>
      setFilters({ ...filters, urgentie: toggle(filters.urgentie, /** @type {any} */ (chip.dataset.urgentie)) }),
    );
  }

  /** @param {Filters} next */
  function setFilters(next) {
    filters = next;
    saveFilters(storage, filters);
    render();
  }

  function render() {
    for (const b of wieButtons) b.setAttribute('aria-pressed', String(b.dataset.wie === filters.wie));
    for (const c of prioChips) c.setAttribute('aria-pressed', String(filters.prio.includes(/** @type {any} */ (c.dataset.prio))));
    for (const c of urgentieChips)
      c.setAttribute('aria-pressed', String(filters.urgentie.includes(/** @type {any} */ (c.dataset.urgentie))));

    const { free, blocked } = takenList(issues, { filters, search, me });
    $('taken-list').replaceChildren(...free.map((row) => rowElement(row, onOpen)));
    $('taken-blocked-list').replaceChildren(...blocked.map((row) => rowElement(row, onOpen)));
    $('taken-blocked').hidden = blocked.length === 0;

    const empty = $('taken-empty');
    const filtered = search.trim() !== '' || JSON.stringify(filters) !== JSON.stringify(ALL);
    empty.textContent = filtered ? 'Geen Taken die hierbij passen.' : 'Geen open Taken.';
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
