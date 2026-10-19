/** Small DOM helpers the screens share. Text is only ever set as text. */

/** @param {string} id */
export const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} tag @param {string} [className] @param {string} [text] */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One labelled checkbox per login, ticked for those in `checked`.
 * @param {string[]} logins @param {string[]} [checked]
 */
export function peopleCheckboxes(logins, checked = []) {
  return logins.map((login) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = login;
    box.checked = checked.includes(login);
    label.append(box, ` ${login}`);
    return label;
  });
}

/**
 * Replaces a select's options; each value is the index into `items`.
 * @param {HTMLSelectElement} select
 * @param {{ title: string }[]} items
 * @param {string | null} none label of the empty choice, if there is one
 */
export function fillSelect(select, items, none) {
  const options = items.map((item, i) => new Option(item.title, String(i)));
  if (none !== null) options.unshift(new Option(none, ''));
  select.replaceChildren(...options);
}

/**
 * Fills a row with one single-select chip per Soort, `chosen` pressed; there
 * is no chip to type a new one. Without any Soort the row is hidden.
 * @param {HTMLElement} row
 * @param {string[]} soorten
 * @param {string | null} chosen
 * @param {(soort: string) => void} onTap
 */
export function fillSoortChips(row, soorten, chosen, onTap) {
  row.hidden = soorten.length === 0;
  replaceKeepingFocus(
    row,
    soorten.map((soort) => {
      const chip = /** @type {HTMLButtonElement} */ (el('button', 'chip', soort));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(soort === chosen));
      chip.addEventListener('click', () => onTap(soort));
      return chip;
    }),
  );
}

/**
 * Redraws a row of chips. The tapped chip is replaced too, so focus moves to
 * the chip in its place, or keyboard users would lose their spot.
 * @param {HTMLElement} row @param {HTMLElement[]} children
 */
export function replaceKeepingFocus(row, children) {
  const focused = [...row.children].indexOf(/** @type {Element} */ (document.activeElement));
  row.replaceChildren(...children);
  if (focused >= 0) /** @type {HTMLElement | undefined} */ (row.children[Math.min(focused, row.children.length - 1)])?.focus();
}
