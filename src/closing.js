/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */

/**
 * The comment for a pasted Kennisbank link, or null when the text isn't a
 * web link. Any web link is accepted: the Kennisbank rule is a convention
 * (Nexus README), not something the app checks.
 * @param {string} text
 */
export function kennisbankComment(text) {
  const link = text.trim();
  if (!/^https?:\/\/\S+$/i.test(link)) return null;
  try {
    new URL(link);
  } catch {
    return null;
  }
  return `📎 Kennisbank: ${link}`;
}

/**
 * Posts a Kennisbank link as a comment on the Taak. False, posting nothing,
 * when the text isn't a web link.
 * @param {Store} store
 * @param {IssueRef} ref
 * @param {string} text
 */
export function addKennisbankLink(store, ref, text) {
  const body = kennisbankComment(text);
  if (body === null) return false;
  store.comment(ref, body);
  return true;
}
