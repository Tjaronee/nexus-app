/** @typedef {'taken' | 'boodschappen' | 'mijlpalen'} TabId */

/** @type {ReadonlyArray<{ id: TabId, label: string }>} */
export const TABS = [
  { id: 'taken', label: 'Taken' },
  { id: 'boodschappen', label: 'Boodschappen' },
  { id: 'mijlpalen', label: 'Mijlpalen' },
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
