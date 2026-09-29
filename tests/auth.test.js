import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateToken } from '../src/auth.js';

/**
 * Fake fetch that answers per URL path.
 * @param {Record<string, number | (() => Response)>} routes
 */
function fakeFetch(routes) {
  /** @type {string[]} */
  const calls = [];
  /** @param {string | URL | Request} input @param {RequestInit} [init] */
  const fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const auth = new Headers(init?.headers).get('Authorization');
    assert.equal(auth, 'Bearer tok');
    const route = routes[url.pathname];
    if (route === undefined) throw new Error(`unexpected ${url.pathname}`);
    if (typeof route === 'function') return route();
    return new Response('{}', { status: route });
  };
  return { fetch, calls };
}

const user = () => Response.json({ login: 'tjaronee', avatar_url: 'https://avatars/x.png' });

test('accepts a token that can read Nexus issues and returns the user', async () => {
  const { fetch } = fakeFetch({
    '/user': user,
    '/repos/Tjaronee/Nexus/issues': 200,
  });
  const result = await validateToken('tok', { fetch });
  assert.deepEqual(result, {
    ok: true,
    user: { login: 'tjaronee', avatarUrl: 'https://avatars/x.png' },
  });
});

test('trims whitespace around a pasted token', async () => {
  const { fetch } = fakeFetch({ '/user': user, '/repos/Tjaronee/Nexus/issues': 200 });
  const result = await validateToken('  tok\n', { fetch });
  assert.equal(result.ok, true);
});

test('rejects an empty token without calling GitHub', async () => {
  const { fetch, calls } = fakeFetch({});
  assert.deepEqual(await validateToken('   ', { fetch }), { ok: false, reason: 'empty' });
  assert.deepEqual(calls, []);
});

test('reports an invalid or expired token on 401', async () => {
  const { fetch } = fakeFetch({ '/user': 401 });
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'invalid' });
});

test('reports no access when Nexus is not visible to the token', async () => {
  const { fetch } = fakeFetch({ '/user': user, '/repos/Tjaronee/Nexus/issues': 404 });
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'no-access' });
});

test('reports no access when the token lacks the Issues permission', async () => {
  const { fetch } = fakeFetch({ '/user': user, '/repos/Tjaronee/Nexus/issues': 403 });
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'no-access' });
});

test('reports invalid when the repo check answers 401', async () => {
  const { fetch } = fakeFetch({ '/user': user, '/repos/Tjaronee/Nexus/issues': 401 });
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'invalid' });
});

test('reports a network problem when GitHub cannot be reached', async () => {
  const fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'network' });
});

test('reports an unexpected GitHub answer as an error', async () => {
  const { fetch } = fakeFetch({ '/user': 500 });
  assert.deepEqual(await validateToken('tok', { fetch }), { ok: false, reason: 'error' });
});
