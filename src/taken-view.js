import { takenList, loadFilters, saveFilters, isFiltered, withKnownSoorten } from './taken.js';
import { knownSoorten, groupBySoort, GEEN_SOORT } from './soort.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./taken.js').Filters} Filters */
/** @typedef {import('./taken.js').Row} Row */
/** @typedef {import('./soort.js').SoortKey} SoortKey */

/**
 * The Taken list in #panel-taken. The controls are static in index.html, so
 * typing in the search box never loses focus; only the lists are redrawn.
 *
 * @param {{ storage: Storage, onOpen: (ref: IssueRef) => void, onClose: (issue: Issue) => void }} deps
 *   `onOpen` is called when a Taak, or the Taak blocking it, is tapped;
 *   `onClose` when its checkbox is ticked.
 */
export function mountTaken({ storage, onOpen, onClose }) {
  let filters = loadFilters(storage);
  let search = '';
  /** @type {Issue[]} */
  let issues = [];
  /** @type {string[]} */
  let labels = [];
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

    // A remembered Soort that was deleted stops applying, and goes from
    // storage with the next tap on a Soort chip.
    const soorten = knownSoorten(labels, issues);
    const active = withKnownSoorten(filters, soorten);
    renderSoortChips(soorten, active);

    const { free, blocked } = takenList(issues, { filters: active, search, me });
    $('taken-groups').replaceChildren(...groupBySoort(free).map((group) => groupElement(group.soort, group.rows, onOpen, onClose)));
    $('taken-blocked-list').replaceChildren(...blocked.map((row) => rowElement(row, onOpen, onClose)));
    $('taken-blocked').hidden = blocked.length === 0;

    const empty = $('taken-empty');
    empty.textContent = search.trim() !== '' || isFiltered(active) ? 'Geen Taken die hierbij passen.' : 'Geen open Taken.';
    empty.hidden = free.length + blocked.length > 0;
  }

  /**
   * One chip per Soort plus "Geen soort", multi-select like the Prio chips.
   * Without any Soort the row is hidden: a lone "Geen soort" would filter nothing.
   * @param {string[]} soorten @param {Filters} active
   */
  function renderSoortChips(soorten, active) {
    const row = $('taken-soorten');
    row.hidden = soorten.length === 0;
    /** @type {SoortKey[]} */
    const keys = [...soorten, null];
    row.replaceChildren(
      ...(row.hidden ? [] : keys).map((soort) => {
        const button = /** @type {HTMLButtonElement} */ (el('button', 'chip', soort ?? GEEN_SOORT));
        button.type = 'button';
        button.setAttribute('aria-pressed', String(active.soort.includes(soort)));
        button.addEventListener('click', () => setFilters({ ...active, soort: toggle(active.soort, soort) }));
        return button;
      }),
    );
  }

  render();

  return {
    /**
     * Redraws with the latest issues. `me` is the signed-in login; `nextLabels`
     * all label names in Nexus, for the Soort chips.
     * @param {Issue[]} nextIssues @param {string} nextMe @param {string[]} [nextLabels]
     */
    update(nextIssues, nextMe, nextLabels = []) {
      issues = nextIssues;
      me = nextMe;
      labels = nextLabels;
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

/**
 * One Soort's Taken, under its name.
 * @param {SoortKey} soort
 * @param {Row[]} rows
 * @param {(ref: IssueRef) => void} onOpen
 * @param {(issue: Issue) => void} onClose
 */
function groupElement(soort, rows, onOpen, onClose) {
  const section = el('section', 'group soort');
  section.append(el('h2', undefined, soort ?? GEEN_SOORT));
  const list = el('ul', 'taken');
  list.append(...rows.map((row) => rowElement(row, onOpen, onClose)));
  section.append(list);
  return section;
}

/**
 * One Taak as a list row.
 * @param {Row} row
 * @param {(ref: IssueRef) => void} onOpen
 * @param {(issue: Issue) => void} onClose
 */
export function rowElement(row, onOpen, onClose) {
  const li = el('li', 'taak');

  // The whole row opens the Taak; the title is the button for keyboards and screen readers.
  li.addEventListener('click', (event) => {
    if (!(/** @type {Element} */ (event.target).closest('.link, .check'))) onOpen(row.issue.ref);
  });
  const head = el('div', 'taak__head');
  // Ticking closes the Taak and the row goes, so it never shows as ticked.
  const check = /** @type {HTMLButtonElement} */ (el('button', 'check'));
  check.type = 'button';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', 'false');
  check.setAttribute('aria-label', `${row.issue.title} afronden`);
  check.addEventListener('click', () => onClose(row.issue));
  head.append(check);
  const titleButton = /** @type {HTMLButtonElement} */ (el('button', 'taak__title', row.issue.title));
  titleButton.type = 'button';
  head.append(titleButton);
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
