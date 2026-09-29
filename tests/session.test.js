import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';
import { memoryStorage } from './memory-storage.js';

const user = { login: 'tjaronee', avatarUrl: 'https://avatars/x.png' };

test('starts signed out', () => {
  const session = createSession(memoryStorage());
  assert.equal(session.current(), null);
});

test('remembers a signed-in token and user across instances', () => {
  const storage = memoryStorage();
  createSession(storage).signIn('tok', user);
  assert.deepEqual(createSession(storage).current(), { token: 'tok', user });
});

test('sign out removes the token but keeps other device data', () => {
  const storage = memoryStorage();
  storage.setItem('nexus.queue', '[1]');
  const session = createSession(storage);
  session.signIn('tok', user);
  session.signOut();
  assert.equal(session.current(), null);
  assert.equal(storage.getItem('nexus.queue'), '[1]');
});

test('treats a token without a stored user as signed out', () => {
  const storage = memoryStorage();
  storage.setItem('nexus.token', 'tok');
  assert.equal(createSession(storage).current(), null);
});

test('treats a corrupt stored user as signed out', () => {
  const storage = memoryStorage();
  storage.setItem('nexus.token', 'tok');
  storage.setItem('nexus.user', '{nope');
  assert.equal(createSession(storage).current(), null);
});

test('updates the stored user', () => {
  const storage = memoryStorage();
  const session = createSession(storage);
  session.signIn('tok', user);
  session.updateUser({ login: 'tjaronee', avatarUrl: 'https://avatars/y.png' });
  assert.equal(createSession(storage).current()?.user.avatarUrl, 'https://avatars/y.png');
});

test('notifies listeners on sign in and sign out', () => {
  const session = createSession(memoryStorage());
  /** @type {(string | null)[]} */
  const seen = [];
  session.subscribe((s) => seen.push(s?.token ?? null));
  session.signIn('tok', user);
  session.signOut();
  assert.deepEqual(seen, ['tok', null]);
});

test('works when storage throws', () => {
  const broken = /** @type {Storage} */ (/** @type {unknown} */ ({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  }));
  const session = createSession(broken);
  assert.equal(session.current(), null);
  session.signIn('tok', user);
  assert.deepEqual(session.current(), { token: 'tok', user });
  session.signOut();
  assert.equal(session.current(), null);
});
