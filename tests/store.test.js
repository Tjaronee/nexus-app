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

/** @param {ReturnType<typeof createStore>} store @param {string} title */
const mijlpaal = (store, title) => store.getState().milestones.find((m) => m.title === title);

test('creating a Mijlpaal: straight to GitHub, without a due date', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  const result = await store.createMijlpaal({ title: 'Bruiloft 2027', description: 'Het feest' });

  assert.equal(result, 'saved');
  const created = server.milestones.find((m) => m.title === 'Bruiloft 2027');
  assert.equal(created?.description, 'Het feest');
  assert.equal(created?.due_on, null);
  assert.equal(mijlpaal(store, 'Bruiloft 2027')?.state, 'open');
  assert.equal(store.getState().pending, 0);
});

test('closing a Mijlpaal keeps its Taken; reopening brings it back', async () => {
  const server = createFakeGitHub();
  server.addIssue({ milestone: server.milestones[0] });
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.editMijlpaal(1, { state: 'closed' }), 'saved');
  assert.equal(server.milestones[0].state, 'closed');
  assert.equal(mijlpaal(store, 'Nieuw huis 2026')?.state, 'closed');
  await store.refresh();
  assert.equal(issue(store, 1)?.milestone?.number, 1);

  assert.equal(await store.editMijlpaal(1, { state: 'open' }), 'saved');
  assert.equal(server.milestones[0].state, 'open');
  assert.equal(mijlpaal(store, 'Nieuw huis 2026')?.state, 'open');
});

test('editing the title and description of a Mijlpaal', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  await store.editMijlpaal(1, { title: 'Nieuw huis 2027', description: 'Uitgesteld' });

  assert.equal(server.milestones[0].title, 'Nieuw huis 2027');
  assert.equal(mijlpaal(store, 'Nieuw huis 2027')?.description, 'Uitgesteld');
});

test('deleting a Mijlpaal', async () => {
  const server = createFakeGitHub();
  server.addMilestone('Weg ermee');
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.deleteMijlpaal(2), 'saved');

  assert.deepEqual(server.milestones.map((m) => m.title), ['Nieuw huis 2026']);
  assert.equal(mijlpaal(store, 'Weg ermee'), undefined);
});

test('a Mijlpaal GitHub refuses is reported and the list stays as it was', async () => {
  const server = createFakeGitHub();
  server.addMilestone('Bruiloft 2027');
  const { store } = setup({ server });
  await store.refresh();
  const before = store.getState().milestones;

  assert.equal(await store.createMijlpaal({ title: 'Bruiloft 2027', description: '' }), 'refused');
  assert.equal(await store.editMijlpaal(2, { title: 'Nieuw huis 2026' }), 'refused');

  assert.deepEqual(store.getState().milestones, before);
  assert.equal(store.getState().failed.length, 2);
  assert.equal(server.milestones.length, 2);
});

test('managing Mijlpalen is online only: nothing is queued without a connection', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();
  server.state.offline = true;

  assert.equal(await store.createMijlpaal({ title: 'Bruiloft 2027', description: '' }), 'offline');
  assert.equal(await store.editMijlpaal(1, { state: 'closed' }), 'offline');

  const state = store.getState();
  assert.equal(state.online, false);
  assert.equal(state.pending, 0);
  assert.equal(state.failed.length, 0);
  server.state.offline = false;
  await store.flush();
  await store.refresh();
  assert.deepEqual(server.milestones.map((m) => [m.title, m.state]), [['Nieuw huis 2026', 'open']]);
});

test('a refused delete leaves the Mijlpaal', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.deleteMijlpaal(99), 'refused');

  assert.equal(store.getState().failed.length, 1);
  assert.deepEqual(store.getState().milestones.map((m) => m.number), [1]);
});

test('a Mijlpaal knows how many issues GitHub counts in it, pull requests too', async () => {
  const server = createFakeGitHub();
  server.addIssue({ milestone: server.milestones[0], state: 'closed' });
  server.addPullRequest('chore').milestone = server.milestones[0];
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(mijlpaal(store, 'Nieuw huis 2026')?.issueCount, 2);
});

test('Mijlpalen cached by an older version are fetched in full once, for their issue count', async () => {
  const server = createFakeGitHub();
  server.addIssue({ milestone: server.milestones[0] });
  const storage = memoryStorage();
  await setup({ server, storage }).store.refresh();
  // As an older version kept them: without issueCount, also in the cached response.
  const cache = JSON.parse(storage.getItem('nexus.cache') ?? '{}');
  const strip = (/** @type {any[]} */ list) => list.map(({ issueCount, ...m }) => m);
  cache.milestones = strip(cache.milestones);
  for (const [path, entry] of cache.responses) if (path.includes('/milestones')) entry.body = strip(entry.body);
  storage.setItem('nexus.cache', JSON.stringify(cache));

  const { store } = setup({ server, storage });
  await store.refresh();

  assert.equal(mijlpaal(store, 'Nieuw huis 2026')?.issueCount, 1);
});

test('a refresh that overlaps a Mijlpaal change does not undo it on screen', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  const refreshing = store.refresh();
  await store.createMijlpaal({ title: 'Bruiloft 2027', description: '' });
  await refreshing;
  assert.ok(mijlpaal(store, 'Bruiloft 2027'));

  await store.refresh();
  assert.ok(mijlpaal(store, 'Bruiloft 2027'));
});

test('a renamed Mijlpaal reaches its Taken, also when a refresh overlapped the rename', async () => {
  const server = createFakeGitHub();
  server.addIssue({ milestone: server.milestones[0] });
  const { store } = setup({ server });
  await store.refresh();

  const refreshing = store.refresh();
  await store.editMijlpaal(1, { title: 'Nieuw huis 2027' });
  await refreshing;
  // No refresh of our own: the store follows up by itself.
  for (let i = 0; i < 10; i++) await settle();

  assert.equal(issue(store, 1)?.milestone?.title, 'Nieuw huis 2027');
});

test('losing the connection disables online-only actions at once', async (t) => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  const env = fakeEnv();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = store.start({ ...env, intervalMs: 20_000 });
  await settle();
  assert.equal(store.getState().online, true);

  env.win.dispatchEvent(new Event('offline'));

  assert.equal(store.getState().online, false);
  stop();
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

test('a link can be removed by the client ID of a blocker that has since reached GitHub', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'verhuizen' });
  const { store } = setup({ server });
  await store.refresh();

  // Its detail screen was opened while it was new, so it still goes by the client ID.
  const busje = store.create({ title: 'busje regelen' });
  store.addBlockedBy(1, busje);
  await store.flush();
  await store.refresh();
  assert.deepEqual(issue(store, 1)?.blockedBy, [2]);

  store.removeBlockedBy(1, busje);
  assert.deepEqual(issue(store, 1)?.blockedBy, [], 'freed at once');
  assert.equal(issue(store, 1)?.blockedByCount, 0);
  store.addBlockedBy(1, busje);
  store.addBlockedBy(1, 2);
  assert.equal(issue(store, 1)?.blockedBy.length, 1, 'the same blocker only once');
});

test('a Taak created offline can be blocked by another', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();
  server.state.offline = true;

  const busje = store.create({ title: 'busje regelen' });
  const dozen = store.create({ title: 'alles in dozen' });
  store.addBlockedBy(dozen, busje);
  server.state.offline = false;
  await store.flush();

  assert.deepEqual(server.blockersOf(2), [1]);
  assert.equal(store.getState().pending, 0);
});

test('a sub-issue move an older version left in the queue is dropped, the rest still sent', async () => {
  const server = createFakeGitHub();
  server.addIssue({ title: 'Verhuizen' });
  server.addIssue({ title: 'notaris' });
  const storage = memoryStorage();
  storage.setItem(
    'nexus.queue',
    JSON.stringify([
      { type: 'parent', ref: 2, parent: 1, previous: null },
      { type: 'update', ref: 2, title: 'notaris bellen' },
    ]),
  );
  const { store } = setup({ server, storage });
  assert.equal(store.getState().pending, 1);

  await store.refresh();
  await store.flush();

  assert.equal(issue(store, 2)?.title, 'notaris bellen');
  assert.equal(server.parentOf(2), null);
  assert.deepEqual(store.getState().failed, []);
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

/** @param {ReturnType<typeof createFakeGitHub>} server */
const serverLabels = (server) => server.labels.map((l) => l.name);

test('creating a label: straight to GitHub, and on the list at once', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.createLabel('soort: huishouden'), 'saved');

  assert.ok(serverLabels(server).includes('soort: huishouden'));
  assert.ok(store.getState().labels.includes('soort: huishouden'));
  assert.equal(store.getState().pending, 0);
  await store.refresh();
  assert.ok(store.getState().labels.includes('soort: huishouden'));
});

test('a label GitHub already has is refused and reported', async () => {
  const server = createFakeGitHub();
  server.addLabel('soort: Klusjes');
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.createLabel('soort: klusjes'), 'refused');

  assert.equal(store.getState().failed.length, 1);
  assert.deepEqual(serverLabels(server).filter((l) => l.startsWith('soort:')), ['soort: Klusjes']);
});

test('deleting a label takes it off every issue, closed ones too', async () => {
  const server = createFakeGitHub();
  server.addLabel('soort: huishouden');
  server.addIssue({ labels: ['soort: huishouden', 'prio: high'] });
  server.addIssue({ labels: ['soort: huishouden'], state: 'closed', state_reason: 'completed' });
  const { store } = setup({ server });
  await store.refresh();

  assert.equal(await store.deleteLabel('soort: huishouden'), 'saved');

  assert.ok(!serverLabels(server).includes('soort: huishouden'));
  assert.deepEqual(server.byNumber(1).labels.map((/** @type {any} */ l) => l.name), ['prio: high']);
  assert.deepEqual(server.byNumber(2).labels, []);
  // On screen at once, not only after the next refresh.
  assert.ok(!store.getState().labels.includes('soort: huishouden'));
  assert.deepEqual(issue(store, 1)?.labels, ['prio: high']);
  assert.deepEqual(issue(store, 2)?.labels, []);
  await store.refresh();
  assert.deepEqual(issue(store, 1)?.labels, ['prio: high']);
  assert.ok(!store.getState().labels.includes('soort: huishouden'));
});

test('a label name with a colon and spaces is sent URL-encoded', async () => {
  const server = createFakeGitHub();
  server.addLabel('soort: sociaal leven');
  const { store } = setup({ server });
  await store.refresh();

  await store.deleteLabel('soort: sociaal leven');

  assert.deepEqual(server.writes().map((w) => [w.method, w.path]), [['DELETE', '/repos/Tjaronee/Nexus/labels/soort%3A%20sociaal%20leven']]);
});

test('deleting a label GitHub does not have is refused and reported', async () => {
  const server = createFakeGitHub();
  const { store } = setup({ server });
  await store.refresh();
  const before = store.getState().labels;

  assert.equal(await store.deleteLabel('soort: weg'), 'refused');

  assert.equal(store.getState().failed.length, 1);
  assert.deepEqual(store.getState().labels, before);
});

test('managing labels is online only: nothing is queued without a connection', async () => {
  const server = createFakeGitHub();
  server.addLabel('soort: klusjes');
  const { store } = setup({ server });
  await store.refresh();
  server.state.offline = true;

  assert.equal(await store.createLabel('soort: tuin'), 'offline');
  assert.equal(await store.deleteLabel('soort: klusjes'), 'offline');

  const state = store.getState();
  assert.equal(state.online, false);
  assert.equal(state.pending, 0);
  assert.equal(state.failed.length, 0);
  server.state.offline = false;
  await store.flush();
  await store.refresh();
  assert.deepEqual(server.writes(), []);
  assert.ok(store.getState().labels.includes('soort: klusjes'));
});

test('a refresh that overlaps a label change does not undo it on screen', async () => {
  const server = createFakeGitHub();
  server.addLabel('soort: klusjes');
  server.addIssue({ labels: ['soort: klusjes'] });
  const { store } = setup({ server });
  await store.refresh();

  const refreshing = store.refresh();
  await store.createLabel('soort: tuin');
  await store.deleteLabel('soort: klusjes');
  await refreshing;

  assert.ok(store.getState().labels.includes('soort: tuin'));
  assert.ok(!store.getState().labels.includes('soort: klusjes'));
  assert.deepEqual(issue(store, 1)?.labels, []);
});
