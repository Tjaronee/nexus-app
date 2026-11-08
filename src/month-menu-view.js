import { monthChoices } from './geparkeerd.js';
import { el } from './dom.js';

/** @typedef {import('./geparkeerd.js').Month} Month */

/**
 * The choice of month to park a Taak until: the next 12 months, then Niet
 * geparkeerd. It is a popover menu like ⋮, opened by the button whose
 * `popovertarget` it is, and must sit in the same dialog as that button, as
 * everything outside an open dialog is inert. The months are drawn as it
 * opens, so they are always counted from today.
 * @param {HTMLButtonElement} trigger
 * @param {HTMLElement} menu
 * @param {{ chosen: () => Month | null, onChoose: (month: Month | null) => void }} deps
 *   `chosen` is the month the Taak is parked until now, or null.
 */
export function mountMonthMenu(trigger, menu, { chosen, onChoose }) {
  trigger.setAttribute('aria-expanded', 'false');
  menu.addEventListener('beforetoggle', (event) => {
    if (/** @type {ToggleEvent} */ (event).newState === 'open') fill();
  });
  menu.addEventListener('toggle', (event) => {
    const open = /** @type {ToggleEvent} */ (event).newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (open) /** @type {HTMLElement | null} */ (menu.querySelector('[aria-current="true"]') ?? menu.querySelector('button'))?.focus();
  });

  function fill() {
    const current = chosen();
    /** @type {{ month: Month | null, name: string }[]} */
    const items = [...monthChoices(new Date()), { month: null, name: 'Niet geparkeerd' }];
    menu.replaceChildren(
      ...items.map(({ month, name }) => {
        const item = /** @type {HTMLButtonElement} */ (el('button', undefined, name));
        item.type = 'button';
        item.setAttribute('aria-current', String(month === current));
        item.addEventListener('click', () => {
          menu.hidePopover();
          onChoose(month);
        });
        return item;
      }),
    );
  }
}
