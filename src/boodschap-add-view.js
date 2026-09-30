import { addBoodschap, suggestions } from './boodschap-add.js';
import { knownPlekken, normalisePlek, plekkenOf } from './boodschappen.js';
import { matchesRef } from './data/model.js';
import { $, el } from './dom.js';

/** @typedef {import('./data/model.js').IssueRef} IssueRef */
/** @typedef {import('./quick-add.js').Store} Store */
/** @typedef {import('./boodschappen.js').Zoom} Zoom */

/** @type {Record<'nieuw' | 'terug' | 'al-op-lijst', string>} */
const SAID = { nieuw: 'Toegevoegd', terug: 'Terug op de lijst', 'al-op-lijst': 'Staat al op de lijst' };

/**
 * The chat-style bar at the bottom of the Boodschappen tab: type a name and
 * press Enter. The field is emptied and keeps focus, so the keyboard stays
 * up for the next one.
 * @param {{ getStore: () => Store | null }} deps
 */
export function mountBoodschapAdd({ getStore }) {
  const form = /** @type {HTMLFormElement} */ ($('ba-form'));
  const name = /** @type {HTMLInputElement} */ ($('ba-name'));
  const note = /** @type {HTMLInputElement} */ ($('ba-note'));
  const newPlek = /** @type {HTMLInputElement} */ ($('ba-new-plek'));
  const status = $('ba-status');
  /** The Plekken the next Boodschap gets. @type {string[]} */
  let chosen = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let statusTimer;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save(null);
  });
  name.addEventListener('input', render);
  newPlek.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // Enter here adds the Plek; it doesn't save the Boodschap.
    event.preventDefault();
    const plek = normalisePlek(newPlek.value);
    if (plek && !chosen.includes(plek)) chosen = [...chosen, plek];
    newPlek.value = '';
    newPlek.hidden = true;
    name.focus();
    render();
  });
  keepAboveKeyboard(form);

  /** @param {IssueRef | null} pick a chosen suggestion */
  function save(pick) {
    const store = getStore();
    if (!store) return;
    const result = addBoodschap(store, { name: name.value, note: note.value, plekken: chosen }, pick);
    if (!result) return;
    const issue = store.getState().issues.find((i) => matchesRef(i, result.ref));
    say(`${SAID[result.outcome]}: ${issue?.title ?? name.value.trim()}`);
    name.value = '';
    note.value = '';
    name.focus();
    render();
  }

  /** @param {string} text */
  function say(text) {
    status.textContent = text;
    status.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.hidden = true), 3000);
  }

  function render() {
    const store = getStore();
    const state = store?.getState();
    const typed = name.value.trim() !== '';
    note.hidden = !typed;

    $('ba-suggestions').replaceChildren(
      ...suggestions(state?.issues ?? [], name.value).map((s) => {
        const button = /** @type {HTMLButtonElement} */ (el('button', 'suggestion', s.issue.title));
        button.type = 'button';
        if (s.open) button.append(el('span', 'muted small', ' · staat al op de lijst'));
        else if (plekkenOf(s.issue).length > 0) button.append(el('span', 'muted small', ` · ${plekkenOf(s.issue).join(', ')}`));
        // Keep the keyboard up: the field must not lose focus to the tap.
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', () => save(s.issue.ref));
        const li = el('li');
        li.append(button);
        return li;
      }),
    );

    // A new Plek is only a label once the Boodschap is saved; show it meanwhile.
    const known = knownPlekken(state?.labels ?? [], state?.issues ?? []);
    const plekken = [...new Set([...known, ...chosen])].sort((a, b) => a.localeCompare(b, 'nl'));
    const chips = plekken.map((plek) => {
      const chip = /** @type {HTMLButtonElement} */ (el('button', 'chip', plek));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(chosen.includes(plek)));
      chip.addEventListener('pointerdown', (event) => event.preventDefault());
      chip.addEventListener('click', () => {
        chosen = chosen.includes(plek) ? chosen.filter((p) => p !== plek) : [...chosen, plek];
        render();
      });
      return chip;
    });
    const add = /** @type {HTMLButtonElement} */ (el('button', 'chip chip--new', '+ nieuwe plek'));
    add.type = 'button';
    add.addEventListener('click', () => {
      newPlek.hidden = false;
      newPlek.focus();
    });
    $('ba-plekken').replaceChildren(...chips, add);
  }

  render();

  return {
    render,
    /**
     * Zoomed in on a Plek: new Boodschappen get it, until another is chosen.
     * @param {Zoom} zoom
     */
    setZoom(zoom) {
      chosen = zoom?.plek ? [zoom.plek] : [];
      render();
    },
  };
}

/**
 * A phone keyboard covers the bottom of the screen without resizing it on
 * some phones; lift the bar by the part it covers. Also tells the page how
 * tall the bar is, so the list and the snackbar stay clear of it.
 * @param {HTMLElement} bar
 */
function keepAboveKeyboard(bar) {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  if (viewport) {
    const lift = () => {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty('--keyboard-h', `${covered}px`);
    };
    viewport.addEventListener('resize', lift);
    viewport.addEventListener('scroll', lift);
  }
  new ResizeObserver(() => root.style.setProperty('--add-bar-h', `${bar.offsetHeight}px`)).observe(bar);
}
