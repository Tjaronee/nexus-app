import { boodschappenList, normalisePlek, plekChoices, plekkenOf, saveBoodschap } from './boodschappen.js';
import { matchesRef } from './data/model.js';
import { $, el, peopleCheckboxes } from './dom.js';

/** @typedef {import('./data/model.js').Issue} Issue */
/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {import('./boodschappen.js').Item} Item */
/** @typedef {import('./boodschappen.js').Zoom} Zoom */

/** How far a row must be swiped left to remove it. */
const SWIPE_PX = 96;
/** A drag shorter than this still counts as a tap. */
const TAP_SLOP_PX = 10;
/** How long after a drag a click is taken to come from that drag. */
const DRAG_CLICK_MS = 400;

/**
 * The Boodschappen tab in #panel-boodschappen, and the sheet to edit one.
 *
 * In het mandje shows what was bought since the app opened, so it empties
 * each time the app starts, or when "Leegmaken" is pressed.
 *
 * @param {{ getStore: () => Store | null, onRemove: (issue: Issue) => void, onZoom: (zoom: Zoom) => void }} deps
 *   `onRemove` closes a Boodschap that is no longer needed; `onZoom` is told
 *   when a Plek chip is tapped.
 */
export function mountBoodschappen({ getStore, onRemove, onZoom }) {
  /** @type {Zoom} */
  let zoom = null;
  let mandjeSince = new Date().toISOString();
  /** What was ticked on this phone since then. @type {IssueRef[]} */
  let tickedHere = [];

  const dialog = /** @type {HTMLDialogElement} */ ($('boodschap'));
  const form = /** @type {HTMLFormElement} */ ($('b-form'));
  const title = /** @type {HTMLInputElement} */ ($('b-title'));
  const note = /** @type {HTMLInputElement} */ ($('b-note'));
  const newPlek = /** @type {HTMLInputElement} */ ($('b-new-plek'));
  /** The Boodschap being edited. @type {IssueRef | null} */
  let editing = null;

  $('b-clear').addEventListener('click', () => {
    mandjeSince = new Date().toISOString();
    tickedHere = [];
    render();
  });

  function render() {
    const store = getStore();
    const view = boodschappenList(store?.getState().issues ?? [], { zoom, mandjeSince, tickedHere });

    $('b-chips').replaceChildren(
      ...view.chips.map((chip) => {
        const label = chip.zoom === null ? 'Alles' : (chip.zoom.plek ?? 'Geen plek');
        const button = /** @type {HTMLButtonElement} */ (el('button', 'chip', `${label} (${chip.count})`));
        button.type = 'button';
        button.setAttribute('aria-pressed', String(chip.selected));
        // Tapping the Plek zoomed in on goes back to all of them.
        button.addEventListener('click', () => {
          zoom = chip.selected ? null : chip.zoom;
          onZoom(zoom);
          render();
        });
        return button;
      }),
    );

    $('b-groups').replaceChildren(
      ...view.groups.map((group) => {
        const section = el('section', 'plek');
        section.append(el('h2', undefined, group.plek ?? 'Geen plek'));
        const list = el('ul', 'boodschappen');
        list.append(...group.items.map(openRow));
        section.append(list);
        return section;
      }),
    );
    const openCount = view.groups.reduce((n, g) => n + g.items.length, 0);
    $('b-empty').textContent = zoom ? 'Hier hoeft niets meer gehaald te worden.' : 'Geen Boodschappen.';
    $('b-empty').hidden = openCount > 0;

    $('b-mandje-list').replaceChildren(...view.mandje.map(mandjeRow));
    $('b-mandje').hidden = view.mandje.length === 0;
  }

  /** @param {Item} item */
  function openRow(item) {
    const li = el('li', 'boodschap');
    const check = /** @type {HTMLButtonElement} */ (el('button', 'check'));
    check.type = 'button';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', 'false');
    check.setAttribute('aria-label', `${item.issue.title} in het mandje`);
    check.addEventListener('click', () => {
      const store = getStore();
      if (!store) return;
      tickedHere = [...tickedHere, item.issue.ref];
      store.close(item.issue.ref, 'completed');
    });
    const name = /** @type {HTMLButtonElement} */ (el('button', 'boodschap__name', item.issue.title));
    name.type = 'button';
    name.addEventListener('click', () => edit(item.issue.ref));
    const text = el('div', 'boodschap__text');
    text.append(name);
    if (item.note) text.append(el('div', 'boodschap__note', item.note));
    if (item.double) text.append(el('div', 'boodschap__double', 'mogelijk dubbel'));
    li.append(check, text);
    swipeToRemove(li, () => onRemove(item.issue));
    return li;
  }

  /** Tapping a Boodschap In het mandje puts it back on the list. @param {Item} item */
  function mandjeRow(item) {
    const li = el('li', 'boodschap boodschap--mandje');
    const button = /** @type {HTMLButtonElement} */ (el('button', 'boodschap__name', item.issue.title));
    button.type = 'button';
    button.setAttribute('aria-label', `${item.issue.title} terug op de lijst`);
    button.addEventListener('click', () => getStore()?.reopen(item.issue.ref));
    li.append(button);
    return li;
  }

  // Editing

  /** @param {IssueRef} ref */
  function edit(ref) {
    const store = getStore();
    const issue = store?.getState().issues.find((i) => matchesRef(i, ref));
    if (!store || !issue) return;
    editing = ref;
    title.value = issue.title;
    note.value = issue.body.trim();
    newPlek.value = '';
    $('b-error').hidden = true;
    $('b-plekken').replaceChildren(...peopleCheckboxes(plekChoices(store.getState().labels, issue), plekkenOf(issue).map(normalisePlek)));
    dialog.showModal();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const store = getStore();
    if (!store || editing === null) return;
    const plekken = [...$('b-plekken').querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value);
    if (saveBoodschap(store, editing, { title: title.value, note: note.value, plekken: [...plekken, newPlek.value] })) {
      dialog.close();
    } else {
      $('b-error').hidden = false;
      title.focus();
    }
  });
  title.addEventListener('input', () => ($('b-error').hidden = true));
  $('b-cancel').addEventListener('click', () => dialog.close());
  $('b-remove').addEventListener('click', () => {
    const issue = getStore()?.getState().issues.find((i) => editing !== null && matchesRef(i, editing));
    dialog.close();
    if (issue) onRemove(issue);
  });

  render();
  return { render };
}

/**
 * Dragging a row to the left far enough removes it; less, and it slides back.
 * Vertical drags are left to the page, so the list still scrolls.
 * @param {HTMLElement} row @param {() => void} onSwiped
 */
function swipeToRemove(row, onSwiped) {
  /** @type {{ x: number, y: number, id: number } | null} */
  let start = null;
  let dx = 0;
  let draggedAt = 0;
  // A drag is not a tap: don't let it also open or tick the Boodschap.
  row.addEventListener(
    'click',
    (event) => {
      if (Date.now() - draggedAt < DRAG_CLICK_MS) event.stopPropagation();
    },
    { capture: true },
  );
  row.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    dx = 0;
  });
  row.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const moveX = event.clientX - start.x;
    if (dx === 0 && Math.abs(event.clientY - start.y) > Math.abs(moveX)) {
      start = null;
      return;
    }
    dx = Math.min(0, moveX);
    row.style.transform = `translateX(${dx}px)`;
    row.classList.add('boodschap--dragging');
    row.classList.toggle('boodschap--removing', dx < -SWIPE_PX);
  });
  const end = () => {
    if (!start) return;
    start = null;
    row.style.transform = '';
    row.classList.remove('boodschap--dragging', 'boodschap--removing');
    if (dx < -TAP_SLOP_PX) draggedAt = Date.now();
    if (dx < -SWIPE_PX) onSwiped();
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', () => {
    dx = 0;
    end();
  });
}
