/** Lowercase without accents, so "cafe" finds "Café". @param {string} text */
export function normalise(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * How a name is written after its prefix in a label such as `waar: ` or
 * `soort: ` (Nexus ADR 0003, 0004): one space, lowercase, and short enough
 * for GitHub's 50 characters per label.
 * @param {string} name
 * @param {string} prefix
 */
export function labelName(name, prefix) {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50 - prefix.length).trim();
}
