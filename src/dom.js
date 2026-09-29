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
