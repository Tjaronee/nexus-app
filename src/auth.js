import { NEXUS_OWNER, NEXUS_REPO } from './config.js';
import { createGitHub, UnauthorizedError } from './github.js';

/** @typedef {{ login: string, avatarUrl: string }} GitHubUser */
/** @typedef {'empty' | 'invalid' | 'no-access' | 'network' | 'error'} TokenProblem */
/** @typedef {{ ok: true, user: GitHubUser } | { ok: false, reason: TokenProblem }} TokenCheck */

/**
 * Checks that a personal access token works and can read Nexus issues.
 *
 * GitHub answers 401 for both a mistyped and an expired token, so those two
 * share the `invalid` reason. A token without access to Nexus sees a 404, and
 * one without the Issues permission a 403; both are `no-access`.
 *
 * @param {string} rawToken
 * @param {{ fetch?: typeof globalThis.fetch }} [deps]
 * @returns {Promise<TokenCheck>}
 */
export async function validateToken(rawToken, { fetch = globalThis.fetch } = {}) {
  const token = rawToken.trim();
  if (!token) return { ok: false, reason: 'empty' };

  const github = createGitHub({ token, fetch, onUnauthorized: () => {} });
  /** @param {string} path */
  const get = (path) => github.request(path, { cache: 'no-store' });

  try {
    const userRes = await get('/user');
    if (!userRes.ok) return { ok: false, reason: 'error' };
    const body = await userRes.json().catch(() => null);
    if (!body?.login) return { ok: false, reason: 'error' };

    const repoRes = await get(`/repos/${NEXUS_OWNER}/${NEXUS_REPO}/issues?per_page=1`);
    if (repoRes.status === 403 || repoRes.status === 404) return { ok: false, reason: 'no-access' };
    if (!repoRes.ok) return { ok: false, reason: 'error' };

    return { ok: true, user: { login: body.login, avatarUrl: body.avatar_url } };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'network' };
  }
}
