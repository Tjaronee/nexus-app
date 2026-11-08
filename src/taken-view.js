import { takenList, loadFilters, saveFilters, isFiltered, withKnownSoorten } from './taken.js';
import { knownSoorten, groupBySoort, GEEN_SOORT } from './soort.js';
import { monthName, standsOut, markSeen, loadSeen, saveSeen } from './geparkeerd.js';
import { $, el, replaceKeepingFocus } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./taken.js').Filters} Filters */
/** @typedef {import('./taken.js').Row} Row */
/** @typedef {import('./soort.js').SoortKey} SoortKey */
/**
 * How a row is drawn beyond its Row: `today` names the months, `relevant` is
 * set for a Taak that stands out as just become relevant.
 * @typedef {{ today: Date, relevant: boolean }} Look
 */

/**
 * The Taken list in #panel-taken. The controls are static in index.html, so
 * typing in the search box never loses focus; only the lists are redrawn.
 *
 * @param {{
 *   storage: Storage,
 *   onOpen: (ref: IssueRef) => void,
 *   onClose: (issue: Issue) => void,
 *   onFilter?: (filters: Filters) => void,
 * }} deps
 *   `onOpen` is called when a Taak, or the Taak blocking it, is tapped;
 *   `onClose` when its checkbox is ticked; `onFilter` with the filters that
 *   apply whenever the list is redrawn, so quick-add can follow the Soort.
 */
export function mountTaken({ storage, onOpen, onClose, onFilter = () => {} }) {
  let filters = loadFilters(storage);
  let search = '';
  /** @type {Issue[]} */
  let issues = [];
  /** @type {string[]} */
  let labels = [];
  let me = '';

  const panel = $('panel-taken');
  const searchInput = /** @type {HTMLInputElement} */ ($('taken-search'));
  const blockedSection = /** @type {HTMLDetailsElement} */ ($('taken-blocked'));
  const parkedSection = /** @type {HTMLDetailsElement} */ ($('taken-parked'));
  /** Whether each folded section was open before a search opened them, to go back to after. @type {boolean[] | null} */
  let openBeforeSearch = null;

  // A Taak that just became relevant stops standing out once it has been on
  // screen on 3 days: counted when half its row is in view, with the app in
  // front and not in a closed section.
  /** @type {WeakMap<Element, Issue>} */
  const relevantRows = new WeakMap();
  const seenObserver = new IntersectionObserver(
    (entries) => {
      if (document.visibilityState !== 'visible') return;
      const seen = entries
        .filter((e) => e.isIntersecting && !e.target.closest('details:not([open])'))
        .flatMap((e) => relevantRows.get(e.target) ?? []);
      if (seen.length > 0) saveSeen(storage, markSeen(loadSeen(storage), seen, new Date()));
    },
    { threshold: 0.5 },
  );
  const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (panel.querySelectorAll('[data-wie], [data-prio]'));

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    render();
  });
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const { wie, prio } = /** @type {any} */ (button.dataset);
      if (wie) setFilters({ ...filters, wie });
      if (prio) setFilters({ ...filters, prio: toggle(filters.prio, prio) });
    });
  }

  /** Whether a filter button is on. @param {HTMLButtonElement} button */
  function pressed(button) {
    const { wie, prio } = /** @type {any} */ (button.dataset);
    return wie ? wie === filters.wie : filters.prio.includes(prio);
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
    onFilter(active);

    const today = new Date();
    const seen = loadSeen(storage);
    seenObserver.disconnect();
    /** @param {Row} row */
    const draw = (row) => {
      const relevant = standsOut(row.issue, today, seen);
      const li = rowElement(row, onOpen, onClose, { today, relevant });
      if (relevant) {
        relevantRows.set(li, row.issue);
        seenObserver.observe(li);
      }
      return li;
    };
    const { free, blocked, parked } = takenList(issues, { filters: active, search, me, today });
    $('taken-groups').replaceChildren(...groupBySoort(free).map((group) => groupElement(group.soort, group.rows.map(draw))));
    fillFolded(blockedSection, 'taken-blocked', blocked.map(draw));
    fillFolded(parkedSection, 'taken-parked', parked.map(draw));
    openWhileSearching();

    const empty = $('taken-empty');
    empty.textContent = search.trim() !== '' || isFiltered(active) ? 'Geen Taken die hierbij passen.' : 'Geen open Taken.';
    empty.hidden = free.length + blocked.length + parked.length > 0;
  }

  /**
   * Fills a folded section and its count; it is hidden while empty.
   * @param {HTMLDetailsElement} section @param {string} id @param {HTMLElement[]} rows
   */
  function fillFolded(section, id, rows) {
    $(`${id}-list`).replaceChildren(...rows);
    $(`${id}-count`).textContent = String(rows.length);
    section.hidden = rows.length === 0;
  }

  /** While searching, both folded sections open, so matches inside them show; after, they are as before. */
  function openWhileSearching() {
    const sections = [blockedSection, parkedSection];
    if (search.trim() !== '') {
      openBeforeSearch ??= sections.map((s) => s.open);
      for (const section of sections) section.open = true;
    } else if (openBeforeSearch) {
      sections.forEach((section, i) => (section.open = /** @type {boolean[]} */ (openBeforeSearch)[i]));
      openBeforeSearch = null;
    }
  }

  /**
   * One chip per Soort plus "Geen soort", multi-select like the Prio chips.
   * Without any Soort the row is hidden: a lone "Geen soort" would filter nothing.
   * @param {string[]} soorten @param {Filters} active
   */
  function renderSoortChips(soorten, active) {
    const row = $('taken-soorten');
    row.hidden = soorten.length === 0;
    if (row.hidden) {
      row.replaceChildren();
      return;
    }
    /** @type {SoortKey[]} */
    const keys = [...soorten, null];
    replaceKeepingFocus(
      row,
      keys.map((soort) => {
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
 * @param {HTMLElement[]} rows the Taken as list rows
 */
export function groupElement(soort, rows) {
  const section = el('section', 'group soort');
  section.append(el('h2', undefined, soort ?? GEEN_SOORT));
  const list = el('ul', 'taken');
  list.append(...rows);
  section.append(list);
  return section;
}

/**
 * One Taak as a list row. One that just became relevant stands out by colour
 * only; screen readers hear it with its title.
 * @param {Row} row
 * @param {(ref: IssueRef) => void} onOpen
 * @param {(issue: Issue) => void} onClose
 * @param {Look} look
 */
export function rowElement(row, onOpen, onClose, { today, relevant }) {
  const li = el('li', relevant ? 'taak taak--relevant' : 'taak');

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
  if (relevant) titleButton.setAttribute('aria-label', `${row.issue.title}, net relevant geworden`);
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
  meta.append(badge(`prio-${row.prio}`, row.prio, `Prio: ${row.prio}`));
  if (row.parkedUntil) meta.append(el('span', 'taak__parked', `tot ${monthName(row.parkedUntil, today)}`));
  li.append(meta);

  for (const blocker of row.waitingFor) {
    const wait = el('div', 'taak__wait', '⛔ wacht op: ');
    const link = /** @type {HTMLButtonElement} */ (el('button', 'link', blocker.title));
    link.type = 'button';
    link.addEventListener('click', () => onOpen(blocker.ref));
    wait.append(link);
    if (blocker.parkedUntil) wait.append(` (geparkeerd tot ${monthName(blocker.parkedUntil, today)})`);
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
