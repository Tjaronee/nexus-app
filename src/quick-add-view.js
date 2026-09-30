import { saveTaak, choices, DEFAULTS } from './quick-add.js';
import { $, fillSelect, peopleCheckboxes } from './dom.js';

/** @typedef {import('./quick-add.js').Draft} Draft */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {ReturnType<typeof choices>} Choices */

/**
 * The + button on the Taken tab and the bottom sheet it opens.
 * @param {{ getStore: () => Store | null, getMe: () => string }} deps
 */
export function mountQuickAdd({ getStore, getMe }) {
  const dialog = /** @type {HTMLDialogElement} */ ($('quick-add'));
  const form = /** @type {HTMLFormElement} */ ($('quick-add-form'));
  const title = /** @type {HTMLInputElement} */ ($('qa-title'));
  const body = /** @type {HTMLTextAreaElement} */ ($('qa-body'));
  const epic = /** @type {HTMLSelectElement} */ ($('qa-epic'));
  const mijlpaal = /** @type {HTMLSelectElement} */ ($('qa-mijlpaal'));
  const blocked = /** @type {HTMLSelectElement} */ ($('qa-blocked'));
  const people = $('qa-people');
  const more = /** @type {HTMLDetailsElement} */ ($('qa-more'));
  const error = $('qa-error');
  const again = $('qa-again');
  const isEpicChip = $('qa-is-epic');
  const chips = /** @type {NodeListOf<HTMLButtonElement>} */ (dialog.querySelectorAll('[data-qa-prio], [data-qa-urgentie]'));
  const taakOnly = /** @type {NodeListOf<HTMLElement>} */ (dialog.querySelectorAll('[data-qa-taak-only]'));
  const nouns = dialog.querySelectorAll('[data-qa-noun]');

  let { isEpic, prio, urgentie } = DEFAULTS;
  /** @type {Choices} */
  let offered = { epics: [], mijlpalen: [], blockers: [], people: [] };

  $('add-taak').addEventListener('click', () => {
    const store = getStore();
    if (!store) return;
    ({ isEpic, prio, urgentie } = DEFAULTS);
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
      renderChips();
    });
  }
  // Only hides the Taak's choices, so turning Epic off again brings them back.
  isEpicChip.addEventListener('click', () => {
    isEpic = !isEpic;
    renderChips();
  });

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
    const ref = saveTaak(store, read());
    error.hidden = ref !== null;
    return ref !== null;
  }

  /** @returns {Draft} */
  function read() {
    return {
      title: title.value,
      body: body.value,
      isEpic,
      prio,
      urgentie,
      epic: epic.value === '' ? null : offered.epics[Number(epic.value)].ref,
      mijlpaal: mijlpaal.value === '' ? null : offered.mijlpalen[Number(mijlpaal.value)].number,
      toegewezen: [...people.querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value),
      blockedBy: [...blocked.selectedOptions].map((o) => offered.blockers[Number(o.value)].ref),
    };
  }

  /**
   * Empties every field except the chips, which carry over to the next one.
   * The choices are fresh, so a Taak just saved can block the next one.
   */
  function clear() {
    const store = getStore();
    if (store) offered = choices(store.getState(), getMe());
    title.value = '';
    body.value = '';
    error.hidden = true;
    fillSelect(epic, offered.epics, 'Geen Epic');
    fillSelect(mijlpaal, offered.mijlpalen, 'Geen Mijlpaal');
    fillSelect(blocked, offered.blockers, null);
    people.replaceChildren(...peopleCheckboxes(offered.people));
    renderChips();
  }

  /** An Epic has no Prio, Urgentie or the Taak-only fields (Nexus ADR 0004). */
  function renderChips() {
    isEpicChip.setAttribute('aria-pressed', String(isEpic));
    for (const chip of chips) {
      const { qaPrio, qaUrgentie } = chip.dataset;
      chip.setAttribute('aria-pressed', String(qaPrio ? qaPrio === prio : qaUrgentie === urgentie));
      chip.disabled = isEpic;
    }
    for (const field of taakOnly) field.hidden = isEpic;
    for (const noun of nouns) noun.textContent = isEpic ? 'Epic' : 'Taak';
  }
}
