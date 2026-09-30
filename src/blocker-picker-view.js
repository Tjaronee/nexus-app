import { el } from './dom.js';

/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./blocker-picker.js').BlockerOption} BlockerOption */
/**
 * A Taak the picker lists as chosen. A closed one is struck through; one the
 * app doesn't know (`known: false`) has no screen to open.
 * @typedef {{ ref: IssueRef, title: string, open: boolean, known: boolean }} Chosen
 */

/**
 * "Geblokkeerd door", shared by quick-add and the detail screen: the chosen
 * Taken, each with a × to remove it, and "+ geblokkeerd door…" to search for
 * one more. The caller decides what adding and removing does, and redraws.
 * @param {HTMLElement} root an empty element to build it in
 * @param {{
 *   search: (query: string) => BlockerOption[],
 *   onAdd: (option: BlockerOption) => void,
 *   onRemove: (ref: IssueRef) => void,
 *   onOpen?: (ref: IssueRef) => void,
 * }} deps `onOpen`, if given, makes a chosen Taak tappable.
 */
export function mountBlockerPicker(root, { search, onAdd, onRemove, onOpen }) {
  const list = el('ul', 'refs');
  const add = button('link', '+ geblokkeerd door…');
  const panel = el('div');
  const query = /** @type {HTMLInputElement} */ (el('input', 'field'));
  query.type = 'search';
  query.placeholder = 'Zoek een open Taak';
  query.setAttribute('aria-label', 'Zoek een open Taak');
  query.autocomplete = 'off';
  const options = el('ul', 'options');
  panel.append(query, options);
  root.append(list, add, panel);
  close();

  add.addEventListener('click', () => {
    const opening = panel.hidden;
    close();
    panel.hidden = !opening;
    if (opening) query.focus();
  });
  query.addEventListener('input', renderOptions);
  // In quick-add, Enter here would save the Taak.
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  function close() {
    panel.hidden = true;
    query.value = '';
    options.replaceChildren();
  }

  function renderOptions() {
    options.replaceChildren(
      ...search(query.value).map((o) => {
        const pick = button('option', o.title);
        if (o.number) pick.append(el('span', 'muted', ` #${o.number}`));
        pick.addEventListener('click', () => {
          close();
          onAdd(o);
        });
        const li = el('li');
        li.append(pick);
        return li;
      }),
    );
  }

  return {
    /** Shows what is chosen now. @param {Chosen[]} chosen */
    render(chosen) {
      list.replaceChildren(
        ...chosen.map((c) => {
          const li = el('li');
          if (onOpen && c.known) {
            const link = button('link', c.title);
            link.addEventListener('click', () => onOpen(c.ref));
            li.append(link);
          } else {
            li.append(c.title);
          }
          if (!c.open) li.classList.add('done');
          const remove = button('remove', '×');
          remove.setAttribute('aria-label', `Niet meer Geblokkeerd door ${c.title}`);
          remove.addEventListener('click', () => onRemove(c.ref));
          li.append(remove);
          return li;
        }),
      );
      if (!panel.hidden) renderOptions();
    },
    /** Hides the search, emptied. */
    close,
  };
}

/** @param {string} className @param {string} text */
function button(className, text) {
  const b = /** @type {HTMLButtonElement} */ (el('button', className, text));
  b.type = 'button';
  return b;
}
