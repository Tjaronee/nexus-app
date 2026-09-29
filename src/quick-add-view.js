import { saveTaak, choices, DEFAULTS } from './quick-add.js';

/** @typedef {import('./quick-add.js').Draft} Draft */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {ReturnType<typeof choices>} Choices */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

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
  const chips = /** @type {NodeListOf<HTMLButtonElement>} */ (dialog.querySelectorAll('[data-qa-prio], [data-qa-urgentie]'));

  let { prio, urgentie } = DEFAULTS;
  /** @type {Choices} */
  let offered = { epics: [], mijlpalen: [], blockers: [], people: [] };

  $('add-taak').addEventListener('click', () => {
    const store = getStore();
    if (!store) return;
    ({ prio, urgentie } = DEFAULTS);
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
      prio,
      urgentie,
      epic: epic.value === '' ? null : offered.epics[Number(epic.value)].ref,
      mijlpaal: mijlpaal.value === '' ? null : offered.mijlpalen[Number(mijlpaal.value)].number,
      toegewezen: [...people.querySelectorAll('input:checked')].map((box) => /** @type {HTMLInputElement} */ (box).value),
      blockedBy: [...blocked.selectedOptions].map((o) => offered.blockers[Number(o.value)].ref),
    };
  }

  /**
   * Empties every field except the chips, which carry over to the next Taak.
   * The choices are fresh, so a Taak just saved can block the next one.
   */
  function clear() {
    const store = getStore();
    if (store) offered = choices(store.getState(), getMe());
    title.value = '';
    body.value = '';
    error.hidden = true;
    fill(epic, offered.epics, 'Geen Epic');
    fill(mijlpaal, offered.mijlpalen, 'Geen Mijlpaal');
    fill(blocked, offered.blockers, null);
    people.replaceChildren(
      ...offered.people.map((login) => {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = login;
        label.append(box, ` ${login}`);
        return label;
      }),
    );
    renderChips();
  }

  function renderChips() {
    for (const chip of chips) {
      const { qaPrio, qaUrgentie } = chip.dataset;
      chip.setAttribute('aria-pressed', String(qaPrio ? qaPrio === prio : qaUrgentie === urgentie));
    }
  }
}

/**
 * Replaces a select's options; each value is the index into `items`.
 * @param {HTMLSelectElement} select
 * @param {{ title: string }[]} items
 * @param {string | null} none label of the empty choice, if there is one
 */
function fill(select, items, none) {
  const options = items.map((item, i) => new Option(item.title, String(i)));
  if (none !== null) options.unshift(new Option(none, ''));
  select.replaceChildren(...options);
}
