/** @typedef {'taken' | 'boodschappen' | 'mijlpalen'} TabId */

/** @type {ReadonlyArray<{ id: TabId, label: string }>} */
export const TABS = [
  { id: 'taken', label: 'Taken' },
  { id: 'boodschappen', label: 'Boodschappen' },
  // Was the Mijlpalen tab; the id stays so a remembered last tab still works.
  { id: 'mijlpalen', label: 'Indeling' },
];

export const LAST_TAB_KEY = 'nexus.lastTab';

/**
 * The tab to open on: the one used last on this device, else Taken.
 * @param {string | null} lastTab
 * @returns {TabId}
 */
export function initialTab(lastTab) {
  return TABS.find((t) => t.id === lastTab)?.id ?? 'taken';
}
