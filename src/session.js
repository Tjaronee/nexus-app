/** @typedef {import('./auth.js').GitHubUser} GitHubUser */
/** @typedef {{ token: string, user: GitHubUser }} Session */

const TOKEN_KEY = 'nexus.token';
const USER_KEY = 'nexus.user';

/**
 * The signed-in token and GitHub user, remembered on this device.
 *
 * Signing out (or an expired token) only removes these two keys, so anything
 * else on the device, like queued changes, survives until the next sign-in.
 * If storage is unavailable the session still works for as long as the page
 * stays open.
 *
 * @param {Storage} storage
 */
export function createSession(storage) {
  /** @type {Session | null} */
  let current = read();
  /** @type {Set<(s: Session | null) => void>} */
  const listeners = new Set();

  function read() {
    try {
      const token = storage.getItem(TOKEN_KEY);
      const user = JSON.parse(storage.getItem(USER_KEY) ?? 'null');
      if (!token || !user?.login) return null;
      return { token, user };
    } catch {
      return null;
    }
  }

  /** @param {Session | null} next */
  function write(next) {
    current = next;
    try {
      if (next) {
        storage.setItem(TOKEN_KEY, next.token);
        storage.setItem(USER_KEY, JSON.stringify(next.user));
      } else {
        storage.removeItem(TOKEN_KEY);
        storage.removeItem(USER_KEY);
      }
    } catch {
      // Storage blocked: keep the session in memory only.
    }
    for (const listener of listeners) listener(current);
  }

  return {
    current: () => current,
    /** @param {string} token @param {GitHubUser} user */
    signIn: (token, user) => write({ token, user }),
    signOut: () => write(null),
    /** @param {GitHubUser} user */
    updateUser: (user) => current && write({ ...current, user }),
    /** @param {(s: Session | null) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
