import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { createGitHub } from '../src/github.js';
import { migrate } from '../tools/migrate-epics.js';

const NIEUW_HUIS = 'Nieuw huis 2026';

/** A trimmed-down copy of Nexus as it was before the migration. */
function nexus() {
  const server = createFakeGitHub();
  const nieuwHuis = server.milestones[0];
  /** @param {number} number @param {Record<string, any>} [fields] */
  const add = (number, fields = {}) => server.addIssue({ number, title: `Taak ${number}`, milestone: nieuwHuis, ...fields });
  const epic = { labels: ['Epic'] };

  add(1, { ...epic, title: 'Epic: New house 2026', state: 'closed', state_reason: 'completed', milestone: null });
  add(8, { ...epic, title: 'Taxaties aanvragen', state: 'closed', state_reason: 'completed' });
  add(10, { state: 'closed' });
  server.setParent(8, 1);
  server.setParent(10, 8);

  add(12, { ...epic, title: 'Verkoop eigen woning', body: 'Beste Prijs Makelaars maakt move-account voor ons aan\n\n' });
  add(13, { title: 'Makelaar kiezen', state: 'closed', state_reason: 'completed' });
  add(20, { state: 'closed' });
  add(46, { state: 'closed', milestone: null });
  add(57, { milestone: null });
  add(49, { state: 'closed' });
  add(50, { state: 'closed' });
  for (const n of [13, 20, 46, 57]) server.setParent(n, 12);
  for (const n of [49, 50]) server.setParent(n, 13);

  add(15, { ...epic, title: 'Koopcontract nieuwe huis', body: null });
  add(16, { state: 'closed' });
  server.setParent(16, 15);

  add(24, { ...epic, title: 'Verhuizen', body: 'Spullen van Kraaijenberg naar Hatert.' });
  add(29);
  add(30, { state: 'closed' });
  for (const n of [29, 30]) server.setParent(n, 24);

  add(37, { ...epic, title: 'Taken nieuwe huis', body: '- [ ] verven' });
  add(65, { state: 'closed' });
  server.setParent(65, 37);

  add(40, { title: 'Hypotheek', state: 'closed', state_reason: 'completed' });
  add(18, { state: 'closed' });
  server.setParent(18, 40);
  return server;
}

/** @param {ReturnType<typeof createFakeGitHub>} server */
function run(server, apply = false) {
  /** @type {string[]} */
  const lines = [];
  const github = createGitHub({ token: 't', onUnauthorized: () => {}, fetch: server.fetch });
  return migrate({ github, apply, log: (line) => lines.push(line) }).then(() => lines);
}

/** @param {ReturnType<typeof createFakeGitHub>} server @param {number} n */
const milestoneOf = (server, n) => server.byNumber(n).milestone?.title ?? null;

test('a dry run lists every change and writes nothing', async () => {
  const server = nexus();
  const lines = await run(server);
  assert.deepEqual(lines, [
    'Create Mijlpaal "Verkoop eigen woning" with description "Beste Prijs Makelaars maakt move-account voor ons aan"',
    'Create Mijlpaal "Koopcontract nieuwe huis" with no description',
    'Create Mijlpaal "Verhuizen" with description "Spullen van Kraaijenberg naar Hatert."',
    'Move #13 "Makelaar kiezen" from "Nieuw huis 2026" to "Verkoop eigen woning"',
    'Move #49 "Taak 49" from "Nieuw huis 2026" to "Verkoop eigen woning"',
    'Move #50 "Taak 50" from "Nieuw huis 2026" to "Verkoop eigen woning"',
    'Move #20 "Taak 20" from "Nieuw huis 2026" to "Verkoop eigen woning"',
    'Move #46 "Taak 46" from no Mijlpaal to "Verkoop eigen woning"',
    'Move #57 "Taak 57" from no Mijlpaal to "Verkoop eigen woning"',
    'Move #16 "Taak 16" from "Nieuw huis 2026" to "Koopcontract nieuwe huis"',
    'Move #29 "Taak 29" from "Nieuw huis 2026" to "Verhuizen"',
    'Move #30 "Taak 30" from "Nieuw huis 2026" to "Verhuizen"',
    'Close #12 "Verkoop eigen woning" as not planned',
    'Close #15 "Koopcontract nieuwe huis" as not planned',
    'Close #24 "Verhuizen" as not planned',
    'Close #37 "Taken nieuwe huis" as not planned',
    'Remove label Epic from #1 "Epic: New house 2026"',
    'Remove label Epic from #8 "Taxaties aanvragen"',
    'Remove label Epic from #12 "Verkoop eigen woning"',
    'Remove label Epic from #15 "Koopcontract nieuwe huis"',
    'Remove label Epic from #24 "Verhuizen"',
    'Remove label Epic from #37 "Taken nieuwe huis"',
    'Dry run: 22 changes planned, nothing changed. Run with --apply to make them.',
  ]);
  assert.deepEqual(server.writes(), []);
});

test('--apply promotes the goal Epics to Mijlpalen and retires every Epic', async () => {
  const server = nexus();
  const lines = await run(server, true);
  assert.equal(lines.at(-1), 'Applied 22 changes.');

  assert.deepEqual(
    server.milestones.map((ms) => [ms.title, ms.description]),
    [
      [NIEUW_HUIS, ''],
      ['Verkoop eigen woning', 'Beste Prijs Makelaars maakt move-account voor ons aan'],
      ['Koopcontract nieuwe huis', ''],
      ['Verhuizen', 'Spullen van Kraaijenberg naar Hatert.'],
    ],
  );
  for (const n of [13, 20, 46, 57, 49, 50]) assert.equal(milestoneOf(server, n), 'Verkoop eigen woning', `#${n}`);
  assert.equal(milestoneOf(server, 16), 'Koopcontract nieuwe huis');
  for (const n of [29, 30]) assert.equal(milestoneOf(server, n), 'Verhuizen', `#${n}`);
  for (const n of [65, 18, 10, 8]) assert.equal(milestoneOf(server, n), NIEUW_HUIS, `#${n}`);
  // Open sub-issues stay open; only the four open Epics are closed.
  assert.equal(server.byNumber(29).state, 'open');
  for (const n of [12, 15, 24, 37]) {
    assert.deepEqual([server.byNumber(n).state, server.byNumber(n).state_reason], ['closed', 'not_planned'], `#${n}`);
  }
  for (const n of [1, 8, 13, 40]) assert.equal(server.byNumber(n).state_reason, 'completed', `#${n}`);
  assert.deepEqual(server.issues.filter((i) => i.labels.some((/** @type {any} */ l) => l.name === 'Epic')), []);
  // Sub-issue links are history; the migration leaves them alone.
  assert.equal(server.parentOf(13), 12);
  assert.equal(server.parentOf(18), 40);
});

test('a second --apply finds nothing left to do', async () => {
  const server = nexus();
  await run(server, true);
  const before = server.writes().length;
  const lines = await run(server, true);
  assert.deepEqual(lines, ['Nothing left to do.']);
  assert.equal(server.writes().length, before);
});

test('an existing Mijlpaal with a stale description is updated, not duplicated', async () => {
  const server = nexus();
  server.addMilestone('Verhuizen', 'old');
  const lines = await run(server, true);
  assert.ok(lines.includes('Set description of Mijlpaal "Verhuizen" to "Spullen van Kraaijenberg naar Hatert."'));
  assert.deepEqual(server.milestones.filter((ms) => ms.title === 'Verhuizen').map((ms) => ms.description), [
    'Spullen van Kraaijenberg naar Hatert.',
  ]);
});
