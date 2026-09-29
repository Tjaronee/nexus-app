import { GITHUB_API } from './config.js';

export class UnauthorizedError extends Error {
  constructor() {
    super('GitHub token is invalid or expired');
    this.name = 'UnauthorizedError';
  }
}

/**
 * Thin authenticated wrapper around the GitHub REST API. Every call that
 * needs the token goes through here, so an expired token is noticed in one
 * place: `onUnauthorized` runs and the call throws `UnauthorizedError`.
 *
 * @param {{
 *   token: string,
 *   onUnauthorized: () => void,
 *   fetch?: typeof globalThis.fetch,
 * }} options
 */
export function createGitHub({ token, onUnauthorized, fetch = globalThis.fetch }) {
  return {
    /**
     * @param {string} path API path starting with `/`
     * @param {RequestInit} [init]
     */
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/vnd.github+json');
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      const res = await fetch(`${GITHUB_API}${path}`, { ...init, headers });
      if (res.status === 401) {
        onUnauthorized();
        throw new UnauthorizedError();
      }
      return res;
    },
  };
}
