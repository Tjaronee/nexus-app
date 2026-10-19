import { saveDraft, choices, soortFromFilter, DEFAULTS } from './quick-add.js';
import { blockerOptions } from './blocker-picker.js';
import { mountBlockerPicker } from './blocker-picker-view.js';
import { $, fillSelect, fillSoortChips, peopleCheckboxes } from './dom.js';
import { tapSoort } from './soort.js';

/** @typedef {import('./quick-add.js').Draft} Draft */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {ReturnType<typeof choices>} Choices */
/** @typedef {import('./blocker-picker.js').BlockerOption} BlockerOption */
/** @typedef {import('./blocker-picker-view.js').Direction} Direction */
/** @typedef {import('./taken.js').Filters} Filters */

/**
 * The + button on the Taken tab and the bottom sheet it opens.
 * @param {{ getStore: () => Store | null, getMe: () => string }} deps
 */
export function mountQuickAdd({ getStore, getMe }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('quick-add'));
  const form = /** @type {HTMLFormElement} */ ($('quick-add-form'));
  const title = /** @type {HTMLInputElement} */ ($('qa-title'));
  const body = /** @type {HTMLTextAreaElement} */ ($('qa-body'));
  const mijlpaal = /** @type {HTMLSelectElement} */ ($('qa-mijlpaal'));
  const people = $('qa-people');
  const soortChips = $('qa-soorten');
  const more = /** @type {HTMLDetailsElement} */ ($('qa-more'));
  const error = $('qa-error');
  const again = $('qa-again');
  const chips = /** @type {NodeListOf<HTMLButtonElement>} */ (dialog.querySelectorAll('[data-qa-prio], [data-qa-urgentie]'));

  let { prio, urgentie, soort } = DEFAULTS;
  /** The Soort a new Taak starts with, from the Taken filter. @type {string | null} */
  let filterSoort = null;
  /** @type {Choices} */
  let offered = { mijlpalen: [], people: [], soorten: [] };
  const blockedBy = linkPicker('qa-blockers', 'geblokkeerd door');
  const blocks = linkPicker('qa-blocks', 'blokkeert');

  $('add-taak').addEventListener('click', () => {
    const store = getStore();
    if (!store) return;
    ({ prio, urgentie } = DEFAULTS);
    soort = filterSoort;
    more.open = false;
    clear();
    dialog.showModal();
    // Still inside the tap, so phones open the keyboard.
    title.focus();
  });

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const { qaPrio, qaUrgentie } = /** @type {any} */ (chip.dataset);
      if (qaPrio) prio = qaPrio;
      if (qaUrgentie) urgentie = qaUrgentie;
      render();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (save()) dialog.close();
  });
  // Keep focus in the title while tapping "Opslaan + nieuw", so the keyboard stays up.
  again.addEventListener('pointerdown', (event) => event.preventDefault());
  again.addEventListener('click', () => {
    if (save()) clear();
    title.focus();
  });
  title.addEventListener('input', () => {
    error.hidden = true;
  });

  /** Saves what is filled in. False, with a message, when there is no title. */
  function save() {
    const store = getStore();
    if (!store) return false;
    const ref = saveDraft(store, read());
    error.hidden = ref !== null;
    return ref !== null;
  }

  /** @returns {Draft} */
  function read() {
    return {
      title: title.value,
      body: body.value,
      prio,
      urgentie,
      soort,
      mijlpaal: mijlpaal.value === '' ? null : offered.mijlpalen[Number(mijlpaal.value)].number,
      toegewezen: [...people.querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value),
      blockedBy: blockedBy.refs(),
      blocks: blocks.refs(),
    };
  }

  /**
   * Empties every field except the chips, Soort included, which carry over to
   * the next one: unlike a Boodschap's Plekken, a run of Taken often shares them.
   * The choices are fresh, and blockers are searched in the store as it is
   * now, so a Taak just saved can block the next one.
   */
  function clear() {
    const store = getStore();
    if (store) offered = choices(store.getState(), getMe());
    title.value = '';
    body.value = '';
    error.hidden = true;
    fillSelect(mijlpaal, offered.mijlpalen, 'Geen Mijlpaal');
    blockedBy.clear();
    blocks.clear();
    people.replaceChildren(...peopleCheckboxes(offered.people));
    render();
  }

  function render() {
    for (const chip of chips) {
      const { qaPrio, qaUrgentie } = chip.dataset;
      chip.setAttribute('aria-pressed', String(qaPrio ? qaPrio === prio : qaUrgentie === urgentie));
    }
    fillSoortChips(soortChips, offered.soorten, soort, (tapped) => {
      soort = tapSoort(soort, tapped);
      render();
    });
  }

  /**
   * Geblokkeerd door or Blokkeert, saved only with the Taak. A Taak picked
   * in one isn't offered in either.
   * @param {string} id @param {Direction} direction
   */
  function linkPicker(id, direction) {
    /** @type {BlockerOption[]} */
    let chosen = [];
    const picker = mountBlockerPicker($(id), {
      direction,
      search(query) {
        const store = getStore();
        if (!store) return [];
        return blockerOptions(store.getState().issues, { self: null, linked: [...blockedBy.refs(), ...blocks.refs()] }, query);
      },
      onAdd(option) {
        chosen = [...chosen, option];
        show();
      },
      onRemove(ref) {
        chosen = chosen.filter((b) => b.ref !== ref);
        show();
      },
    });
    const show = () => picker.render(chosen.map((b) => ({ ref: b.ref, title: b.title, open: true, known: true })));
    return {
      refs: () => chosen.map((b) => b.ref),
      clear() {
        chosen = [];
        picker.close();
        show();
      },
    };
  }

  return {
    /**
     * The Taken filter changed: with exactly one Soort on, the next new Taak
     * starts in it, as a zoomed-in Plek does for a new Boodschap.
     * @param {Filters} filters the filters that apply now
     */
    setFilter(filters) {
      filterSoort = soortFromFilter(filters);
    },
  };
}
