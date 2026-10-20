/** @typedef {'taken' | 'boodschappen' | 'pakketten' | 'mijlpalen'} TabId */
/** @typedef {{ id: TabId, label: string }} Tab */

/** The tabs in the tab bar. @type {ReadonlyArray<Tab>} */
export const TABS = [
  { id: 'taken', label: 'Taken' },
  { id: 'boodschappen', label: 'Boodschappen' },
  { id: 'pakketten', label: 'Pakketten' },
];

/** The tabs behind ⋮ at the end of the tab bar. A tab added here gets an item in its menu. @type {ReadonlyArray<Tab>} */
export const MORE_TABS = [
  // Was the Mijlpalen tab; the id stays so a remembered last tab still works.
  { id: 'mijlpalen', label: 'Indeling' },
];

/** @type {ReadonlyArray<Tab>} */
export const ALL_TABS = [...TABS, ...MORE_TABS];

export const LAST_TAB_KEY = 'nexus.lastTab';

/**
 * The tab to open on: the one used last on this device, else Taken.
 * @param {string | null} lastTab
 * @returns {TabId}
 */
export function initialTab(lastTab) {
  return ALL_TABS.find((t) => t.id === lastTab)?.id ?? 'taken';
}
