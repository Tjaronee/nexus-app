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
