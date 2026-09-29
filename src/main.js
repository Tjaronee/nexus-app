import { validateToken } from './auth.js';
import { $ } from './dom.js';
import { createStore } from './data/store.js';
import { createGitHub } from './github.js';
import { createSession } from './session.js';
import { TABS, LAST_TAB_KEY, initialTab } from './tabs.js';
import { mountTaken } from './taken-view.js';
import { mountQuickAdd } from './quick-add-view.js';
import { mountDetail } from './detail-view.js';

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
const detail = mountDetail({ getStore: () => store, getMe });
const taken = mountTaken({ storage, onOpen: detail.open });
mountQuickAdd({ getStore: () => store, getMe });

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
    for (const id of ['settings', 'quick-add', 'detail']) {
      const dialog = /** @type {HTMLDialogElement} */ ($(id));
      if (dialog.open) dialog.close();
    }
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
    store.subscribe(renderTaken);
    store.subscribe(detail.render);
    stopSync = store.start();
  }
  renderSync();
  renderTaken();
}

function renderTaken() {
  taken.update(store?.getState().issues ?? [], getMe());
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

function setUpTabs() {
  /** @param {TabId} id */
  function show(id) {
    for (const tab of TABS) {
      const selected = tab.id === id;
      $(`tab-${tab.id}`).setAttribute('aria-selected', String(selected));
      $(`tab-${tab.id}`).tabIndex = selected ? 0 : -1;
      $(`panel-${tab.id}`).hidden = !selected;
      if (selected) {
        $('tab-title').textContent = tab.label;
        document.title = `${tab.label} · Nexus`;
      }
    }
    try {
      storage.setItem(LAST_TAB_KEY, id);
    } catch {
      // Not remembered; the app opens on Taken next time.
    }
  }

  TABS.forEach((tab, i) => {
    const button = $(`tab-${tab.id}`);
    button.addEventListener('click', () => show(tab.id));
    // Arrow keys move between tabs, as only the selected tab is in the tab order.
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = TABS[(i + step + TABS.length) % TABS.length];
      show(next.id);
      $(`tab-${next.id}`).focus();
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
