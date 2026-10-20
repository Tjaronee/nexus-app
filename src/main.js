import { validateToken } from './auth.js';
import { $ } from './dom.js';
import { createStore } from './data/store.js';
import { createGitHub } from './github.js';
import { createSession } from './session.js';
import { TABS, MORE_TABS, ALL_TABS, LAST_TAB_KEY, initialTab } from './tabs.js';
import { mountTaken } from './taken-view.js';
import { mountMijlpalen } from './mijlpalen-view.js';
import { mountSoorten } from './soorten-view.js';
import { mountPlekken } from './plekken-view.js';
import { mountBoodschappen } from './boodschappen-view.js';
import { mountBoodschapAdd } from './boodschap-add-view.js';
import { mountQuickAdd } from './quick-add-view.js';
import { mountDetail } from './detail-view.js';
import { mountClosing } from './closing-view.js';
import { mountKennisbank } from './kennisbank-view.js';

/** @typedef {import('./auth.js').TokenProblem} TokenProblem */
/** @typedef {import('./tabs.js').TabId} TabId */

/** @type {Record<TokenProblem, string>} */
const TOKEN_PROBLEMS = {
  empty: 'Plak eerst je token.',
  invalid: 'Dit token werkt niet: het is ongeldig of verlopen. Maak een nieuw token aan.',
  'no-access':
    'Dit token heeft geen toegang tot de issues van Tjaronee/Nexus. Kies bij Repository access alleen Tjaronee/Nexus en zet Issues op Read and write.',
  network: 'Geen verbinding met GitHub. Probeer het opnieuw zodra je online bent.',
  error: 'GitHub gaf een onverwacht antwoord. Probeer het later opnieuw.',
};

const EXPIRED_NOTICE =
  'Je token werkt niet meer (verlopen of ingetrokken). Plak een nieuw token. Wijzigingen die nog wachten gaan niet verloren.';

const storage = safeLocalStorage();
const session = createSession(storage);
/** Set when the token stops working, so the token screen can explain why. */
let expired = false;
/** @type {ReturnType<typeof createStore> | null} */
let store = null;
/** @type {(() => void) | null} */
let stopSync = null;
/** @type {string | null} */
let connectedToken = null;
const getMe = () => session.current()?.user.login ?? '';
const kennisbank = mountKennisbank({ getStore: () => store });
const closing = mountClosing({ getStore: () => store, onAddFile: kennisbank.addFile });
const detail = mountDetail({ getStore: () => store, getMe, onAddFile: kennisbank.addFile });
const quickAdd = mountQuickAdd({ getStore: () => store, getMe });
const taken = mountTaken({ storage, onOpen: detail.open, onClose: closing.close, onFilter: quickAdd.setFilter });
const mijlpalen = mountMijlpalen({ getStore: () => store, onOpen: detail.open, onClose: closing.close });
const soorten = mountSoorten({ getStore: () => store });
const plekken = mountPlekken({ getStore: () => store });
const boodschapAdd = mountBoodschapAdd({ getStore: () => store });
const boodschappen = mountBoodschappen({ getStore: () => store, onRemove: closing.remove, onZoom: boodschapAdd.setZoom });

session.subscribe(render);
session.subscribe(connect);
render();
connect();
revalidateInBackground();
setUpLogin();
setUpTabs();
setUpSettings();
$('dismiss-failed').addEventListener('click', () => store?.dismissFailed());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function render() {
  const current = session.current();
  $('login').hidden = current !== null;
  $('app').hidden = current === null;
  if (current) {
    for (const id of ['avatar', 'settings-avatar']) {
      /** @type {HTMLImageElement} */ ($(id)).src = current.user.avatarUrl;
    }
    $('settings-login').textContent = current.user.login;
  } else {
    const notice = $('login-notice');
    notice.textContent = EXPIRED_NOTICE;
    notice.hidden = !expired;
    for (const id of ['settings', 'quick-add', 'detail', 'kennisbank', 'boodschap', 'mijlpaal-form', 'soort-form']) {
      const dialog = /** @type {HTMLDialogElement} */ ($(id));
      if (dialog.open) dialog.close();
    }
    closing.hide();
  }
}

/** Starts talking to Nexus with the current token, or stops when signed out. */
function connect() {
  const current = session.current();
  if ((current?.token ?? null) === connectedToken) return;
  stopSync?.();
  stopSync = null;
  store = null;
  connectedToken = current?.token ?? null;
  if (current) {
    const github = createGitHub({ token: current.token, onUnauthorized: expireSession });
    store = createStore({ github, storage });
    store.subscribe(renderSync);
    store.subscribe(renderLists);
    store.subscribe(detail.render);
    stopSync = store.start();
  }
  renderSync();
  renderLists();
}

function renderLists() {
  const state = store?.getState();
  taken.update(state?.issues ?? [], getMe(), state?.labels ?? []);
  mijlpalen.update(state?.issues ?? [], state?.milestones ?? [], state?.online ?? true);
  soorten.update(state?.issues ?? [], state?.labels ?? [], state?.online ?? true);
  plekken.update(state?.issues ?? [], state?.labels ?? [], state?.online ?? true);
  boodschappen.render();
  boodschapAdd.render();
}

/** The small indicator of waiting changes, and a notice for refused ones. */
function renderSync() {
  const state = store?.getState();
  const indicator = $('sync');
  const pending = state?.pending ?? 0;
  const parts = [];
  if (state && !state.online) parts.push('geen verbinding');
  if (pending > 0) parts.push(pending === 1 ? '1 wijziging wacht' : `${pending} wijzigingen wachten`);
  indicator.textContent = parts.join(' · ');
  indicator.hidden = parts.length === 0;

  const failed = state?.failed.length ?? 0;
  $('failed-text').textContent =
    failed === 1
      ? 'Een wijziging is niet opgeslagen: GitHub weigerde hem.'
      : `${failed} wijzigingen zijn niet opgeslagen: GitHub weigerde ze.`;
  $('failed').hidden = failed === 0;
}

/** Token is revoked or has expired: back to the token screen, keep everything else. */
function expireSession() {
  expired = true;
  session.signOut();
}

/**
 * Re-check a remembered token when the app opens, so an expired token sends
 * us back to the token screen. Offline or GitHub hiccups are ignored.
 */
async function revalidateInBackground() {
  const current = session.current();
  if (!current) return;
  const check = await validateToken(current.token);
  if (session.current()?.token !== current.token) return;
  if (check.ok) session.updateUser(check.user);
  // Only a 401 means the token is dead; a 403 can also be a rate limit.
  else if (check.reason === 'invalid') expireSession();
}

function setUpLogin() {
  const form = /** @type {HTMLFormElement} */ ($('login-form'));
  const input = /** @type {HTMLInputElement} */ ($('token'));
  const error = $('login-error');
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Controleren…';
    const token = input.value.trim();
    const check = await validateToken(token);
    submit.disabled = false;
    submit.textContent = 'Inloggen';
    if (check.ok) {
      input.value = '';
      expired = false;
      session.signIn(token, check.user);
    } else {
      error.textContent = TOKEN_PROBLEMS[check.reason];
      error.hidden = false;
      input.focus();
    }
  });
}

/**
 * The tab bar holds TABS and, at its end, ⋮: a popover menu with MORE_TABS.
 * A tab from that menu opens full-screen like any other, and ⋮ then shows
 * as the selected tab. The popover closes itself on a tap outside it, on
 * Escape and on Android's back, without a history entry of its own.
 */
function setUpTabs() {
  const more = $('tab-more');
  const menu = $('more-menu');
  /** @type {TabId} */
  let current = initialTab(null);
  /** @type {Map<TabId, HTMLButtonElement>} */
  const items = new Map();
  for (const tab of MORE_TABS) {
    // Its tab button is in the menu, so the panel carries its own name.
    $(`panel-${tab.id}`).setAttribute('aria-label', tab.label);
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = tab.label;
    item.setAttribute('aria-controls', `panel-${tab.id}`);
    item.addEventListener('click', () => {
      menu.hidePopover();
      show(tab.id);
    });
    items.set(tab.id, item);
  }
  menu.replaceChildren(...items.values());
  menu.addEventListener('toggle', (event) => {
    const open = /** @type {ToggleEvent} */ (event).newState === 'open';
    more.setAttribute('aria-expanded', String(open));
    const [first] = items.values();
    if (open) (items.get(current) ?? first)?.focus();
  });
  const barTabs = TABS.map((tab) => ({ tab, button: $(`tab-${tab.id}`) }));

  /** @param {TabId} id */
  function show(id) {
    current = id;
    for (const tab of ALL_TABS) {
      const selected = tab.id === id;
      $(`panel-${tab.id}`).hidden = !selected;
      if (selected) {
        $('tab-title').textContent = tab.label;
        document.title = `${tab.label} · Nexus`;
      }
    }
    for (const { tab, button } of barTabs) {
      const selected = tab.id === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const behindMore = MORE_TABS.find((t) => t.id === id);
    more.setAttribute('aria-selected', String(behindMore !== undefined));
    more.setAttribute('aria-label', behindMore ? `Meer, nu ${behindMore.label}` : 'Meer');
    if (behindMore) more.setAttribute('aria-controls', `panel-${id}`);
    else more.removeAttribute('aria-controls');
    more.tabIndex = behindMore ? 0 : -1;
    for (const [tabId, item] of items) item.setAttribute('aria-current', tabId === id ? 'page' : 'false');
    try {
      storage.setItem(LAST_TAB_KEY, id);
    } catch {
      // Not remembered; the app opens on Taken next time.
    }
  }

  for (const { tab, button } of barTabs) button.addEventListener('click', () => show(tab.id));
  const bar = [...barTabs.map((b) => b.button), more];
  bar.forEach((button, i) => {
    // Arrow keys move between tabs, as only the selected tab is in the tab order.
    // Arriving on ⋮ only focuses it, and makes it the tab stop; Enter or Space opens its menu.
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = (i + step + bar.length) % bar.length;
      if (next < TABS.length) show(TABS[next].id);
      else for (const other of bar) other.tabIndex = other === more ? 0 : -1;
      bar[next].focus();
    });
  });

  let last = null;
  try {
    last = storage.getItem(LAST_TAB_KEY);
  } catch {
    // Fall back to the default tab.
  }
  show(initialTab(last));
}

function setUpSettings() {
  const dialog = /** @type {HTMLDialogElement} */ ($('settings'));
  $('open-settings').addEventListener('click', () => dialog.showModal());
  $('sign-out').addEventListener('click', () => {
    if (!confirm('Afmelden en je token van dit apparaat verwijderen?')) return;
    expired = false;
    session.signOut();
  });
}

/** localStorage can be missing or throw (private mode, blocked site data). */
function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return /** @type {Storage} */ (/** @type {unknown} */ ({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }));
  }
}
