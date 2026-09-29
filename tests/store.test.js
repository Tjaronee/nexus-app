import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/data/store.js';
import { createGitHub } from '../src/github.js';
import { createFakeGitHub } from './fake-github.js';
import { memoryStorage } from './memory-storage.js';

/** @param {{ server?: ReturnType<typeof createFakeGitHub>, storage?: Storage, onUnauthorized?: () => void }} [options] */
function setup({ server = createFakeGitHub(), storage = memoryStorage(), onUnauthorized = () => {} } = {}) {
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized });
  const store = createStore({ github, storage, newId: counter() });
  return { server, storage, store, github };
}

function counter() {
  let n = 0;
  return () => `cid-${++n}`;
}

/** @param {ReturnType<typeof createStore>} store @param {number | string} ref */
const issue = (store, ref) => store.getState().issues.find((i) => i.ref === ref);

test('refresh loads open and closed issues, but not pull requests', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'Meubels opmeten' });
  server.addIssue({ title: 'melk', state: 'closed', state_reason: 'completed', labels: ['boodschappen'] });
  server.addPullRequest('chore: docs');
  const { store } = setup({ server });

  await store.refresh();

  assert.deepEqual(
    store.getState().issues.map((i) => i.title).sort(),
    ['Meubels opmeten', 'melk'],
  );
});

test('an unchanged refresh only gets 304s, across all pages', async () => {
  const server = createFakeGitHub({ pageSize: 2 });
  for (let i = 0; i < 5; i++) server.addIssue();
  const { store } = setup({ server });
  await store.refresh();
  server.state.log.length = 0;

  await store.refresh();

  assert.equal(store.getState().issues.length, 5);
  const issueCalls = server.state.log.filter((e) => e.path.includes('/issues?'));
  assert.equal(issueCalls.length, 3);
  assert.ok(server.state.log.every((e) => e.status === 304), JSON.stringify(server.state.log));
});

test('opens with the last-fetched issues when there is no connection', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'melk', labels: ['boodschappen'] });
  const storage = memoryStorage();
  await setup({ server, storage }).store.refresh();

  server.state.offline = true;
  const { store } = setup({ server, storage });
  assert.deepEqual(store.getState().issues.map((i) => i.title), ['melk']);

  await store.refresh();
  assert.equal(store.getState().online, false);
  assert.deepEqual(store.getState().issues.map((i) => i.title), ['melk']);
});

test('a cached device still only gets 304s when nothing changed', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  const storage = memoryStorage();
  await setup({ server, storage }).store.refresh();
  server.state.log.length = 0;

  await setup({ server, storage }).store.refresh();

  assert.ok(server.state.log.every((e) => e.status === 304), JSON.stringify(server.state.log));
});

test('a change shows at once, waits as pending, and is then sent', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'Meubels meten' });
  const { store } = setup({ server });
  await store.refresh();

  store.update(1, { title: 'Meubels opmeten' });

  assert.equal(issue(store, 1)?.title, 'Meubels opmeten');
  assert.equal(store.getState().pending, 1);
  await store.flush();
  assert.equal(server.byNumber(1).title, 'Meubels opmeten');
  assert.equal(store.getState().pending, 0);
  assert.equal(issue(store, 1)?.title, 'Meubels opmeten');
});

test('an issue created offline shows at once and reaches GitHub once after reconnecting', async () => {
  const server = createFakeGitHub();
  const storage = memoryStorage();
  const first = setup({ server, storage }).store;
  await first.refresh();
  server.state.offline = true;

  const ref = first.create({ title: 'melk', labels: ['boodschappen'] });
  assert.equal(issue(first, ref)?.title, 'melk');
  assert.equal(issue(first, ref)?.number, null);
  await first.flush();
  assert.equal(first.getState().pending, 1);
  assert.equal(first.getState().online, false);

  // The app is closed and reopened, then the connection comes back.
  const { store } = setup({ server, storage });
  assert.equal(store.getState().pending, 1);
  server.state.offline = false;
  await store.flush();

  assert.equal(server.issues.length, 1);
  assert.deepEqual(server.issues[0].labels, [{ name: 'boodschappen' }]);
  assert.equal(store.getState().pending, 0);
  const created = store.getState().issues.find((i) => i.title === 'melk');
  assert.equal(created?.number, 1);
  assert.equal(created?.body, '');
});

test('a create whose answer got lost is not sent a second time', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  server.state.dropNextResponse = true;
  store.create({ title: 'melk' });
  await store.flush();
  await store.flush();

  assert.equal(server.writes().filter((w) => w.method === 'POST').length, 1);
  assert.equal(server.issues.length, 1);
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().issues.filter((i) => i.title === 'melk').length, 1);
});

test('a comment whose answer got lost is not posted a second time', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  const { store } = setup({ server });
  await store.refresh();

  server.state.dropNextResponse = true;
  store.comment(1, 'Kennisbank: https://drive.google.com/x');
  await store.flush();
  await store.flush();

  assert.equal(server.comments.get(1)?.length, 1);
  assert.equal(store.getState().pending, 0);
  assert.deepEqual(store.comments(1).map((c) => c.body), ['Kennisbank: https://drive.google.com/x']);
});

test('a blocker whose answer got lost is not reported as refused', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  server.addIssue();
  const { store } = setup({ server });
  await store.refresh();

  server.state.dropNextResponse = true;
  store.addBlockedBy(2, 1);
  store.setParent(1, 2);
  await store.flush();
  await store.flush();

  assert.deepEqual(server.blockersOf(2), [1]);
  assert.equal(store.getState().pending, 0);
  assert.deepEqual(store.getState().failed, []);
});

test('queued changes wait for the issues to load instead of being refused', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'oud' });
  const storage = memoryStorage();
  const first = setup({ server, storage }).store;
  await first.refresh();
  server.state.offline = true;
  first.update(1, { title: 'nieuw' });
  await first.flush();
  storage.removeItem('nexus.cache'); // say, dropped to make room

  const { store } = setup({ server, storage });
  await store.flush();
  assert.equal(store.getState().pending, 1);
  assert.deepEqual(store.getState().failed, []);

  server.state.offline = false;
  await store.refresh();
  await store.flush();
  assert.equal(server.byNumber(1).title, 'nieuw');
  assert.deepEqual(store.getState().failed, []);
});

test('changes to an issue created offline follow it once it exists', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();
  server.state.offline = true;

  const ref = store.create({ title: 'melk' });
  store.update(ref, { title: 'halfvolle melk' });
  assert.equal(issue(store, ref)?.title, 'halfvolle melk');
  server.state.offline = false;
  await store.flush();

  assert.equal(server.byNumber(1).title, 'halfvolle melk');
});

test('closing and reopening an issue', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'melk', labels: ['boodschappen'] });
  const { store } = setup({ server });
  await store.refresh();

  store.close(1, 'completed');
  assert.equal(issue(store, 1)?.state, 'closed');
  assert.equal(issue(store, 1)?.stateReason, 'completed');
  await store.flush();
  assert.equal(server.byNumber(1).state, 'closed');
  assert.equal(server.byNumber(1).state_reason, 'completed');

  store.reopen(1);
  assert.equal(issue(store, 1)?.state, 'open');
  await store.flush();
  assert.equal(server.byNumber(1).state, 'open');
});

test('setting Prio and Urgentie swaps the English label, keeping other labels', async () => {
  const server = createFakeGitHub();
  server.addIssue({ labels: ['prio: low', 'waar: praxis'] });
  const { store } = setup({ server });
  await store.refresh();

  store.setPrio(1, 'hoog');
  store.setUrgentie(1, 'nu');
  assert.deepEqual(issue(store, 1)?.labels.sort(), ['prio: high', 'urgency: now', 'waar: praxis']);
  // Meanwhile the partner adds a Plek on the other phone.
  server.byNumber(1).labels.push({ name: 'waar: centrum' });
  await store.flush();

  assert.deepEqual(
    server.byNumber(1).labels.map((/** @type {any} */ l) => l.name).sort(),
    ['prio: high', 'urgency: now', 'waar: centrum', 'waar: praxis'],
  );
});

test('adding and removing labels', async () => {
  const server = createFakeGitHub();
  server.addIssue({ labels: ['boodschappen', 'waar: praxis'] });
  const { store } = setup({ server });
  await store.refresh();

  store.editLabels(1, { add: ['waar: centrum'], remove: ['waar: praxis', 'waar: nergens'] });
  assert.deepEqual(issue(store, 1)?.labels, ['boodschappen', 'waar: centrum']);
  await store.flush();

  assert.deepEqual(server.byNumber(1).labels.map((/** @type {any} */ l) => l.name), ['boodschappen', 'waar: centrum']);
  assert.equal(store.getState().pending, 0);
});

test('Toegewezen: assigning and unassigning', async () => {
  const server = createFakeGitHub();
  server.addIssue({ assignees: [{ login: 'merel', avatar_url: 'https://avatars/m' }] });
  const { store } = setup({ server });
  await store.refresh();

  store.editAssignees(1, { add: ['tjaronee'], remove: ['merel'] });
  assert.deepEqual(issue(store, 1)?.assignees.map((a) => a.login), ['tjaronee']);
  await store.flush();

  assert.deepEqual(server.byNumber(1).assignees.map((/** @type {any} */ a) => a.login), ['tjaronee']);
});

test('moving a Taak to a Mijlpaal and out again', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  const { store } = setup({ server });
  await store.refresh();

  store.setMilestone(1, 1);
  assert.deepEqual(issue(store, 1)?.milestone, { number: 1, title: 'Nieuw huis 2026' });
  await store.flush();
  assert.equal(server.byNumber(1).milestone?.number, 1);

  store.setMilestone(1, null);
  await store.flush();
  assert.equal(server.byNumber(1).milestone, null);
});

test('refresh loads which Taken block an open Taak', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'busje regelen' });
  server.addIssue({ title: 'verhuizen' });
  server.block(2, 1);
  const { store } = setup({ server });

  await store.refresh();

  assert.deepEqual(issue(store, 2)?.blockedBy, [1]);
  assert.deepEqual(issue(store, 1)?.blockedBy, []);
});

test('blocking and unblocking a Taak uses GitHub issue dependencies', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'busje regelen' });
  server.addIssue({ title: 'verhuizen' });
  const { store } = setup({ server });
  await store.refresh();

  store.addBlockedBy(2, 1);
  assert.deepEqual(issue(store, 2)?.blockedBy, [1]);
  await store.flush();
  assert.deepEqual(server.blockersOf(2), [1]);

  store.removeBlockedBy(2, 1);
  assert.deepEqual(issue(store, 2)?.blockedBy, []);
  await store.flush();
  assert.deepEqual(server.blockersOf(2), []);
  await store.refresh();
  assert.deepEqual(issue(store, 2)?.blockedBy, []);
});

test('a Taak created offline can be blocked by and put under an Epic', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'Verhuizen', labels: ['Epic'] });
  const { store } = setup({ server });
  await store.refresh();
  server.state.offline = true;

  const busje = store.create({ title: 'busje regelen' });
  const dozen = store.create({ title: 'alles in dozen' });
  store.addBlockedBy(dozen, busje);
  store.setParent(dozen, 1);
  assert.equal(issue(store, dozen)?.parent, 1);
  server.state.offline = false;
  await store.flush();

  assert.deepEqual(server.blockersOf(3), [2]);
  assert.equal(server.parentOf(3), 1);
  assert.equal(store.getState().pending, 0);
});

test('moving a Taak to another Epic and out of it', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'Verhuizen', labels: ['Epic'] });
  server.addIssue({ title: 'Koopcontract', labels: ['Epic'] });
  server.addIssue({ title: 'notaris' });
  server.setParent(3, 1);
  const { store } = setup({ server });
  await store.refresh();
  assert.equal(issue(store, 3)?.parent, 1);

  store.setParent(3, 2);
  await store.flush();
  assert.equal(server.parentOf(3), 2);

  store.setParent(3, null);
  assert.equal(issue(store, 3)?.parent, null);
  await store.flush();
  assert.equal(server.parentOf(3), null);
});

test('comments load on request, and new ones show before they are sent', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  server.comments.set(1, [{ id: 1, body: 'eerste', user: { login: 'merel', avatar_url: 'm' }, created_at: '2026-09-01T00:00:00Z' }]);
  const { store } = setup({ server });
  await store.refresh();

  await store.loadComments(1);
  store.comment(1, 'Kennisbank: https://drive.google.com/x');

  assert.deepEqual(store.comments(1).map((c) => [c.body, c.pending]), [
    ['eerste', false],
    ['Kennisbank: https://drive.google.com/x', true],
  ]);
  assert.equal(issue(store, 1)?.comments, 1);
  await store.flush();
  assert.equal(server.comments.get(1)?.length, 2);
  assert.deepEqual(store.comments(1).map((c) => [c.body, c.pending]), [
    ['eerste', false],
    ['Kennisbank: https://drive.google.com/x', false],
  ]);
});

test('an expired token keeps queued changes and reports the expiry', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  const storage = memoryStorage();
  let expired = 0;
  const { store } = setup({ server, storage, onUnauthorized: () => expired++ });
  await store.refresh();

  server.state.unauthorized = true;
  store.update(1, { title: 'x' });
  await store.flush();
  assert.ok(expired > 0);
  assert.equal(store.getState().pending, 1);
  await store.refresh(); // must not throw

  // Signed in again with a new token.
  server.state.unauthorized = false;
  const again = setup({ server, storage }).store;
  await again.flush();
  assert.equal(server.byNumber(1).title, 'x');
});

test('a change GitHub refuses is dropped and reported, and the rest still goes', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'a' });
  server.addIssue({ title: 'b' });
  const { store } = setup({ server });
  await store.refresh();

  store.addBlockedBy(1, 999);
  store.update(2, { title: 'b2' });
  await store.flush();

  assert.equal(store.getState().pending, 0);
  assert.equal(server.byNumber(2).title, 'b2');
  assert.equal(store.getState().failed.length, 1);
  store.dismissFailed();
  assert.equal(store.getState().failed.length, 0);
});

test('a refresh that overlaps a write does not undo the change on screen', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'oud' });
  const { store } = setup({ server });
  await store.refresh();
  server.addIssue({ title: 'van de partner' });

  const refreshing = store.refresh();
  store.update(1, { title: 'nieuw' });
  await store.flush();
  await refreshing;
  assert.equal(issue(store, 1)?.title, 'nieuw');

  await store.refresh();
  assert.equal(issue(store, 1)?.title, 'nieuw');
  assert.equal(issue(store, 1)?.updatedAt, server.byNumber(1).updated_at);
});

/** Stand-ins for window and document, to fire online and visibility events. */
function fakeEnv() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  return { win, doc };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('while open and visible, the list refreshes every 20 s', async (t) => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  const env = fakeEnv();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = store.start({ ...env, intervalMs: 20_000 });
  await settle();

  server.addIssue({ title: 'nieuw op de andere telefoon' });
  t.mock.timers.tick(20_000);
  await settle();
  assert.equal(store.getState().issues.length, 1);

  env.doc.visibilityState = 'hidden';
  server.addIssue();
  t.mock.timers.tick(20_000);
  await settle();
  assert.equal(store.getState().issues.length, 1);

  env.doc.visibilityState = 'visible';
  env.doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(store.getState().issues.length, 2);
  stop();
});

test('coming back online sends waiting changes', async (t) => {
  const server = createFakeGitHub();
  server.addIssue();
  const { store } = setup({ server });
  const env = fakeEnv();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = store.start({ ...env, intervalMs: 20_000 });
  await settle();
  server.state.offline = true;
  store.update(1, { title: 'offline gewijzigd' });
  await settle();

  server.state.offline = false;
  env.win.dispatchEvent(new Event('online'));
  await settle();

  assert.equal(server.byNumber(1).title, 'offline gewijzigd');
  assert.equal(store.getState().pending, 0);
  stop();
});

test('listeners hear about changes', async () => {
  const server = createFakeGitHub();
  server.addIssue();
  const { store } = setup({ server });
  let calls = 0;
  store.subscribe(() => calls++);
  await store.refresh();
  store.update(1, { title: 'x' });
  await store.flush();
  assert.ok(calls >= 2);
});

test('a refresh picks up changes made on the other phone', async () => {
  const server = createFakeGitHub({ pageSize: 2 });
  server.addIssue({ title: 'a' });
  const { store } = setup({ server });
  await store.refresh();

  server.addIssue({ title: 'b' });
  server.byNumber(1).title = 'a2';
  await store.refresh();

  assert.deepEqual(store.getState().issues.map((i) => i.title), ['a2', 'b']);
});
