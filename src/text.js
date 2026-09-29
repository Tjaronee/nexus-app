/** Lowercase without accents, so "cafe" finds "Café". @param {string} text */
export function normalise(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
