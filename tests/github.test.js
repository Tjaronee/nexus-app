import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, UnauthorizedError } from '../src/github.js';

test('sends authenticated requests to the GitHub API', async () => {
  /** @type {Request | undefined} */
  let seen;
  const github = createGitHub({
    token: 'tok',
    onUnauthorized: () => assert.fail('not expected'),
    fetch: async (input, init) => {
      seen = new Request(input, init);
      return Response.json({ ok: 1 });
    },
  });
  const res = await github.request('/repos/Tjaronee/Nexus/issues', { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
  assert.equal(seen?.url, 'https://api.github.com/repos/Tjaronee/Nexus/issues');
  assert.equal(seen?.method, 'POST');
  assert.equal(seen?.headers.get('Authorization'), 'Bearer tok');
  assert.equal(seen?.headers.get('Accept'), 'application/vnd.github+json');
});

test('a 401 reports the token as expired and throws', async () => {
  let expired = 0;
  const github = createGitHub({
    token: 'tok',
    onUnauthorized: () => expired++,
    fetch: async () => new Response('{}', { status: 401 }),
  });
  await assert.rejects(github.request('/user'), UnauthorizedError);
  assert.equal(expired, 1);
});

test('other errors are returned to the caller untouched', async () => {
  const github = createGitHub({
    token: 'tok',
    onUnauthorized: () => assert.fail('not expected'),
    fetch: async () => new Response('{}', { status: 404 }),
  });
  assert.equal((await github.request('/x')).status, 404);
});
