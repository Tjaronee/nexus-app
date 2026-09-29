import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kennisbankComment, addKennisbankLink } from '../src/kennisbank.js';
import { createStore } from '../src/data/store.js';
import { createGitHub } from '../src/github.js';
import { createFakeGitHub } from './fake-github.js';
import { memoryStorage } from './memory-storage.js';

function setup() {
  const server = createFakeGitHub();
  const github = createGitHub({ token: 'tok', fetch: server.fetch, onUnauthorized: () => {} });
  let n = 0;
  const store = createStore({ github, storage: memoryStorage(), newId: () => `cid-${++n}` });
  return { server, store };
}

const KENNISBANK_LINK = 'https://drive.google.com/file/d/abc123/view?usp=sharing';

test('a pasted link becomes a Kennisbank comment', () => {
  assert.equal(kennisbankComment(`  ${KENNISBANK_LINK}\n`), `📎 Kennisbank: ${KENNISBANK_LINK}`);
});

test('anything that is not a web link is refused', () => {
  assert.equal(kennisbankComment(''), null);
  assert.equal(kennisbankComment('   '), null);
  assert.equal(kennisbankComment('factuur.pdf'), null);
  assert.equal(kennisbankComment('javascript:alert(1)'), null);
  assert.equal(kennisbankComment('https://drive.google.com/a b'), null);
});

test('ticking a Taak and then undoing leaves it open, with no comment', async () => {
  const { server, store } = setup();
  const taak = server.addIssue({ title: 'Dozen halen' });
  await store.refresh();

  store.close(taak.number, 'completed');
  store.reopen(taak.number);
  await store.flush();

  assert.equal(server.byNumber(taak.number).state, 'open');
  assert.equal(server.comments.get(taak.number)?.length ?? 0, 0);
});

test('a Kennisbank link ends up as a comment on the issue', async () => {
  const { server, store } = setup();
  const taak = server.addIssue({ title: 'Huurcontract tekenen' });
  await store.refresh();
  store.close(taak.number, 'completed');

  assert.equal(addKennisbankLink(store, taak.number, KENNISBANK_LINK), true);
  await store.flush();

  assert.equal(server.byNumber(taak.number).state, 'closed');
  assert.deepEqual(
    server.comments.get(taak.number)?.map((c) => c.body.replace(/\s*<!-- cid:.* -->$/, '')),
    [`📎 Kennisbank: ${KENNISBANK_LINK}`],
  );
});

test('a link that is refused posts nothing', () => {
  const { store } = setup();
  assert.equal(addKennisbankLink(store, 1, 'geen link'), false);
  assert.equal(store.getState().pending, 0);
});
