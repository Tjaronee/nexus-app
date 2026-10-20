import { labelName } from './text.js';

/**
 * A saved Locatie: its name as shown and written into a Pakket, its name as
 * in the label (`key`), the labels it is written as (none for Thuis before
 * it has an address) and its address, empty when it has none.
 * @typedef {{ locatie: string, key: string, labels: string[], adres: string }} Locatie
 */
/** What the Locatie form has filled in, as typed. @typedef {{ naam: string, adres: string }} LocatieDraft */
/**
 * What saving the Locatie form does: create a label, edit one (only what
 * changed), or why it can't: no name, one that is already saved, or an
 * address that is too long.
 * @typedef {{ create: { name: string, description: string } }
 *   | { edit: { label: string, name?: string, description?: string } }
 *   | { problem: 'naam' | 'adres' }
 *   | { problem: 'bestaat', locatie: string }} LocatieChange
 */

export const LOCATIE_PREFIX = 'locatie: ';
/** GitHub keeps at most 100 characters of a label's description. */
export const ADRES_MAX = 100;
const THUIS = 'thuis';

/** How a Locatie is written in its label: the same way as a Plek (Nexus ADR 0005). @param {string} name */
export function locatieKey(name) {
  return labelName(name, LOCATIE_PREFIX);
}

/**
 * The saved Locaties: Thuis first, also when its label doesn't exist, then
 * the `locatie:` labels alphabetically, each with the address in its
 * description (Nexus ADR 0005).
 * @param {string[]} labels all label names in Nexus
 * @param {Record<string, string>} descriptions label name → description
 * @returns {Locatie[]}
 */
export function savedLocaties(labels, descriptions) {
  // GitHub label names ignore case: "locatie: Buren" and "locatie: buren" are
  // one label. Spaced differently they are two, listed as one Locatie.
  /** @type {Map<string, string>} */
  const written = new Map();
  for (const label of labels) {
    if (label.startsWith(LOCATIE_PREFIX) && !written.has(label.toLowerCase())) written.set(label.toLowerCase(), label);
  }
  /** @type {Map<string, string[]>} */
  const byKey = new Map([[THUIS, []]]);
  for (const label of written.values()) {
    const key = locatieKey(label.slice(LOCATIE_PREFIX.length));
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), label]);
  }
  return [...byKey]
    .map(([key, labels]) => ({
      locatie: displayName(key),
      key,
      labels,
      adres: labels.map((l) => descriptions[l] ?? '').find(Boolean) ?? '',
    }))
    .sort((a, b) => Number(b.key === THUIS) - Number(a.key === THUIS) || a.key.localeCompare(b.key, 'nl'));
}

/**
 * The saved Locatie a Pakket's Locatie is, compared normalised, or null.
 * @param {string} text as in the Pakket
 * @param {Locatie[]} locaties
 */
export function matchLocatie(text, locaties) {
  const key = locatieKey(text);
  return locaties.find((l) => l.key === key) ?? null;
}

/**
 * What saving the Locatie form does, for a new Locatie (`row` null) or an
 * existing one. Thuis keeps its name: only its address changes, and its
 * label is created the first time it gets one. Null when nothing changes.
 * @param {Locatie | null} row
 * @param {LocatieDraft} draft
 * @param {Locatie[]} locaties
 * @returns {LocatieChange | null}
 */
export function locatieChange(row, draft, locaties) {
  const adres = draft.adres.replace(/\s+/g, ' ').trim();
  if (adres.length > ADRES_MAX) return { problem: 'adres' };
  if (row?.key === THUIS) {
    if (row.labels.length > 0) return adres === row.adres ? null : { edit: { label: row.labels[0], description: adres } };
    return adres ? { create: { name: LOCATIE_PREFIX + THUIS, description: adres } } : null;
  }
  const key = locatieKey(draft.naam);
  if (!key) return { problem: 'naam' };
  const other = locaties.find((l) => l.key === key && l !== row);
  if (other) return { problem: 'bestaat', locatie: other.locatie };
  if (row === null) return { create: { name: LOCATIE_PREFIX + key, description: adres } };

  /** @type {{ label: string, name?: string, description?: string }} */
  const edit = { label: row.labels[0] };
  if (key !== row.key) edit.name = LOCATIE_PREFIX + key;
  if (adres !== row.adres) edit.description = adres;
  return Object.keys(edit).length > 1 ? { edit } : null;
}

/**
 * How a Locatie is shown and written into a Pakket: its label name with a
 * capital, as Thuis is written.
 * @param {string} key
 */
function displayName(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}
