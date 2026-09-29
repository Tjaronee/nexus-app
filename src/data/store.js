import { NEXUS_OWNER, NEXUS_REPO } from '../config.js';
import { UnauthorizedError } from '../github.js';
import { toIssue, PRIO_LABELS, URGENTIE_LABELS } from './model.js';
import { apply, send, settle, MissingIssueError } from './ops.js';

/** @typedef {import('./model.js').Issue} Issue */
/** @typedef {import('./model.js').IssueRef} IssueRef */
/** @typedef {import('./model.js').Person} Person */
/** @typedef {import('./model.js').Prio} Prio */
/** @typedef {import('./model.js').Urgentie} Urgentie */
/** @typedef {{ number: number, title: string, state: 'open' | 'closed', description: string, dueOn: string | null }} Milestone */
/** @typedef {{ id: number | null, body: string, author: Person | null, createdAt: string, pending: boolean }} Comment */
/** @typedef {import('./ops.js').Op} Op */
/** @typedef {import('./ops.js').QueuedOp} QueuedOp */
/** @typedef {ReturnType<import('../github.js').createGitHub>} GitHub */
/** @typedef {{ etag: string, body: any, next: string | null }} CachedResponse */

const REPO = `/repos/${NEXUS_OWNER}/${NEXUS_REPO}`;
const CACHE_KEY = 'nexus.cache';
const QUEUE_KEY = 'nexus.queue';

/**
 * The single way the app reads and writes Nexus.
 *
 * Screens see `base` (what GitHub last told us) with every queued change
 * applied on top, so a change shows at once and survives refreshes until
 * GitHub has it. Both the base and the queue are kept on the device.
 *
 * @param {{ github: GitHub, storage: Storage, newId?: () => string }} deps
 */
export function createStore({ github, storage, newId = () => crypto.randomUUID() }) {
  const cache = readJson(storage, CACHE_KEY);
  /** @type {Issue[]} */
  let base = cache?.issues ?? [];
  /** @type {Milestone[]} */
  let milestones = cache?.milestones ?? [];
  /** @type {string[]} All label names in Nexus. */
  let labels = cache?.labels ?? [];
  /** Last response per GET path, so unchanged data costs a free 304. */
  /** @type {Map<string, CachedResponse>} */
  const responses = new Map(cache?.responses ?? []);
  /** @type {QueuedOp[]} */
  let queue = readJson(storage, QUEUE_KEY) ?? [];
  let online = true;
  /** Bumped by every write GitHub accepted; a refresh that overlaps one is stale. */
  let writes = 0;
  /** @type {Issue[] | null} */
  let view = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Promise<void> | null} */
  let flushing = null;
  /** @type {Promise<void> | null} */
  let flushAgain = null;
  /** Changes GitHub refused, so the screen can say they didn't happen. */
  /** @type {{ op: Op, status: number }[]} */
  let failed = [];
  /** Comments per issue number, loaded when an issue is opened. */
  /** @type {Map<number, Comment[]>} */
  const loadedComments = new Map();

  /**
   * Fetches the comments of an issue; read them with `comments(ref)`.
   * @param {IssueRef} ref
   */
  async function loadComments(ref) {
    const number = resolve(ref)?.number;
    if (!number) return;
    const res = await conditionalGet(`${REPO}/issues/${number}/comments?per_page=100`, toComments);
    loadedComments.set(number, res.body);
    changed();
  }

  /** Loaded comments plus ones still waiting to be sent. @param {IssueRef} ref @returns {Comment[]} */
  function comments(ref) {
    const issue = issues().find((i) => i.ref === ref || i.cid === ref);
    const loaded = (issue?.number && loadedComments.get(issue.number)) || [];
    const waiting = queue.flatMap((op) =>
      op.type === 'comment' && (op.ref === issue?.ref || op.ref === issue?.cid)
        ? [{ id: null, body: op.body, author: null, createdAt: op.at, pending: true }]
        : [],
    );
    return [...loaded, ...waiting];
  }

  function issues() {
    view ??= queue.reduce(apply, base);
    return view;
  }

  function changed() {
    view = null;
    for (const listener of listeners) listener();
  }

  function persistCache() {
    writeJson(storage, CACHE_KEY, { issues: base, milestones, labels, responses: [...responses] });
  }

  function persistQueue() {
    writeJson(storage, QUEUE_KEY, queue);
  }

  /** @param {Op} op */
  function enqueue(op) {
    const seq = (queue.at(-1)?.seq ?? 0) + 1;
    queue = [...queue, { ...op, seq }];
    persistQueue();
    changed();
    void flush();
  }

  /** @param {any} raw */
  function upsert(raw) {
    const fresh = toIssue(raw);
    const known = base.some((i) => i.number === fresh.number);
    base = known ? base.map((i) => (i.number === fresh.number ? { ...fresh, blockedBy: i.blockedBy } : i)) : [...base, fresh];
  }

  /**
   * Replaces whichever of these labels the issue has with the one for `value`.
   * An unlabelled issue only gets a label now, when the field is changed.
   * @template {string} V
   * @param {IssueRef} ref
   * @param {Record<V, string>} labels
   * @param {V} value
   */
  function swapLabel(ref, labels, value) {
    const current = issues().find((i) => i.ref === ref || i.cid === ref)?.labels ?? [];
    const others = Object.values(labels).filter((l) => l !== labels[value] && current.includes(/** @type {string} */ (l)));
    enqueue({ type: 'labels', ref, add: [labels[value]], remove: /** @type {string[]} */ (others) });
  }

  /** A person by login, with their avatar if we have seen it. @param {string} login @returns {Person} */
  function person(login) {
    const known = issues().flatMap((i) => i.assignees).find((a) => a.login === login && a.avatarUrl);
    return known ?? { login, avatarUrl: `https://github.com/${encodeURIComponent(login)}.png` };
  }

  /** @param {IssueRef} ref */
  const resolve = (ref) =>base.find((i) => i.ref === ref || (i.cid !== null && i.cid === ref));

  /**
   * Sends queued changes in order. Stops at the first one that can't be sent
   * yet (offline, rate limited, token expired) and keeps it for later.
   * @returns {Promise<void>}
   */
  function flush() {
    if (flushing) {
      // Asked again mid-run (say, the connection just came back): go once more after.
      flushAgain ??= flushing.then(() => {
        flushAgain = null;
        return flush();
      });
      return flushAgain;
    }
    const run = (async () => {
      while (queue.length > 0) {
        const outcome = await sendOne(queue[0]);
        if (outcome === 'retry') return;
        queue = queue.slice(1);
        persistQueue();
        changed();
      }
    })();
    flushing = run;
    run.finally(() => {
      if (flushing === run) flushing = null;
    }).catch(() => {});
    return run;
  }

  /** @param {QueuedOp} op @returns {Promise<'done' | 'dropped' | 'retry'>} */
  async function sendOne(op) {
    if (op.type === 'create' && !op.attempted) {
      // Remember the try before making it: if the answer is lost, the next
      // try first checks whether GitHub created the issue anyway.
      queue = [{ ...op, attempted: true }, ...queue.slice(1)];
      persistQueue();
    }
    try {
      const raw = await send(op, { request: github.request, repo: REPO, resolve });
      online = true;
      writes++;
      if (raw) upsert(raw);
      else base = apply(base, settle(op, resolve));
      persistCache();
      if (op.type === 'comment') await loadComments(op.ref).catch(() => {});
      return 'done';
    } catch (err) {
      if (err instanceof UnauthorizedError) return 'retry';
      if (err instanceof Response && isTemporary(err)) return 'retry';
      if (err instanceof MissingIssueError || err instanceof Response) {
        failed = [...failed, { op, status: err instanceof Response ? err.status : 404 }];
        return 'dropped';
      }
      if (isNetworkError(err)) {
        online = false;
        changed();
        return 'retry';
      }
      throw err;
    }
  }

  /**
   * GET with If-None-Match. Returns the (possibly cached) body and whether it
   * changed. `shape` trims the body before it is kept, to save device storage.
   * @param {string} path
   * @param {(body: any) => any} [shape]
   */
  async function conditionalGet(path, shape = (body) => body) {
    const cached = responses.get(path);
    const headers = cached ? { 'If-None-Match': cached.etag } : undefined;
    const res = await github.request(path, { headers, cache: 'no-store' });
    if (res.status === 304 && cached) return { ...cached, changed: false };
    if (!res.ok) throw new HttpError(res.status);
    const entry = {
      etag: res.headers.get('etag') ?? '',
      body: shape(await res.json()),
      next: nextPage(res.headers.get('link')),
    };
    if (entry.etag) responses.set(path, entry);
    return { ...entry, changed: true };
  }

  /**
   * The list only says how many issues block each one; fetch which, for open
   * issues that have any. Each of these is ETag-cached too.
   * @param {Issue[]} list
   */
  async function withBlockers(list) {
    return Promise.all(
      list.map(async (i) => {
        if (i.state !== 'open' || i.blockedByCount === 0) return i;
        const res = await conditionalGet(`${REPO}/issues/${i.number}/dependencies/blocked_by?per_page=100`, (raw) =>
          raw.map((/** @type {any} */ b) => b.number),
        );
        return { ...i, blockedBy: res.body };
      }),
    );
  }

  async function refresh() {
    const writesBefore = writes;
    /** @type {string[]} */
    const paths = [];
    try {
      /** @type {Issue[]} */
      const fetched = [];
      let anyChanged = false;
      /** @type {string | null} */
      let path = `${REPO}/issues?state=all&per_page=100&sort=created&direction=asc`;
      while (path) {
        paths.push(path);
        const page = await conditionalGet(path, toIssues);
        fetched.push(...page.body);
        anyChanged ||= page.changed;
        path = page.next;
      }
      const ms = await conditionalGet(`${REPO}/milestones?state=all&per_page=100`, toMilestones);
      const ls = await conditionalGet(`${REPO}/labels?per_page=100`, (raw) => raw.map((/** @type {any} */ l) => l.name));
      online = true;
      if (writes !== writesBefore) {
        // A write landed meanwhile, so this answer may predate it. Forget
        // the ETags so the next refresh fetches the new state in full.
        for (const p of paths) responses.delete(p);
      } else if (anyChanged) {
        base = await withBlockers(fetched);
      }
      milestones = ms.body;
      labels = ls.body;
      if (anyChanged || ms.changed || ls.changed) persistCache();
    } catch (err) {
      // An expired token is handled by the client's onUnauthorized; a GitHub
      // hiccup just means we try again on the next refresh.
      if (isNetworkError(err)) online = false;
      else if (!(err instanceof UnauthorizedError || err instanceof HttpError)) throw err;
    }
    changed();
  }

  return {
    /**
     * Keeps the data fresh while the app is open: refreshes now, every
     * `intervalMs` while visible, on return to the foreground, and sends
     * waiting changes when the connection comes back. Returns a stop function.
     * @param {{ win?: EventTarget, doc?: EventTarget & { visibilityState: string }, intervalMs?: number }} [env]
     */
    start({ win = globalThis.window, doc = globalThis.document, intervalMs = 20_000 } = {}) {
      const sync = () => {
        void flush();
        void refresh();
      };
      const onVisible = () => doc.visibilityState === 'visible' && sync();
      const timer = setInterval(onVisible, intervalMs);
      doc.addEventListener('visibilitychange', onVisible);
      win.addEventListener('online', sync);
      sync();
      return () => {
        clearInterval(timer);
        doc.removeEventListener('visibilitychange', onVisible);
        win.removeEventListener('online', sync);
      };
    },
    getState: () => ({ issues: issues(), milestones, labels, online, pending: queue.length, failed }),
    dismissFailed() {
      failed = [];
      changed();
    },
    loadComments,
    comments,
    /** @param {IssueRef} ref @param {string} body */
    comment: (ref, body) => enqueue({ type: 'comment', ref, body, at: new Date().toISOString() }),
    /** @param {() => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    flush,
    /**
     * Creates an issue. Returns its client ID, which works as its ref until
     * (and after) GitHub gives it a number.
     * @param {{ title: string, body?: string, labels?: string[], assignees?: string[], milestone?: number | null }} fields
     */
    create(fields) {
      const cid = newId();
      enqueue({
        type: 'create',
        cid,
        at: new Date().toISOString(),
        title: fields.title,
        body: fields.body ?? '',
        labels: fields.labels ?? [],
        assignees: fields.assignees ?? [],
        milestone: fields.milestone ?? null,
      });
      return cid;
    },
    /** @param {IssueRef} ref @param {{ title?: string, body?: string }} fields */
    update: (ref, fields) => enqueue({ type: 'update', ref, ...fields }),
    /** @param {IssueRef} ref @param {'completed' | 'not_planned'} reason */
    close: (ref, reason) => enqueue({ type: 'state', ref, state: 'closed', reason }),
    /** @param {IssueRef} ref */
    reopen: (ref) => enqueue({ type: 'state', ref, state: 'open', reason: 'reopened' }),
    /** @param {IssueRef} ref @param {{ add?: string[], remove?: string[] }} change */
    editLabels: (ref, { add = [], remove = [] }) => enqueue({ type: 'labels', ref, add, remove }),
    /** @param {IssueRef} ref @param {Prio} prio */
    setPrio: (ref, prio) => swapLabel(ref, PRIO_LABELS, prio),
    /** @param {IssueRef} ref @param {Urgentie} urgentie */
    setUrgentie: (ref, urgentie) => swapLabel(ref, URGENTIE_LABELS, urgentie),
    /** Toegewezen. @param {IssueRef} ref @param {{ add?: string[], remove?: string[] }} change */
    editAssignees: (ref, { add = [], remove = [] }) =>
      enqueue({ type: 'assignees', ref, add: add.map(person), remove }),
    /** Geblokkeerd door. @param {IssueRef} ref @param {IssueRef} blocker */
    addBlockedBy: (ref, blocker) => enqueue({ type: 'blockedBy', ref, blocker, add: true }),
    /** @param {IssueRef} ref @param {IssueRef} blocker */
    removeBlockedBy: (ref, blocker) => enqueue({ type: 'blockedBy', ref, blocker, add: false }),
    /** Puts a Taak under an Epic, or (with null) takes it out. @param {IssueRef} ref @param {IssueRef | null} parent */
    setParent(ref, parent) {
      const previous = issues().find((i) => i.ref === ref || i.cid === ref)?.parent ?? null;
      enqueue({ type: 'parent', ref, parent, previous });
    },
    /** @param {IssueRef} ref @param {number | null} number */
    setMilestone:(ref, number) =>
      enqueue({
        type: 'milestone',
        ref,
        milestone: number === null ? null : { number, title: milestones.find((m) => m.number === number)?.title ?? '' },
      }),
  };
}

/** Rate limits and GitHub outages pass; anything else won't succeed on retry. @param {Response} res */
function isTemporary(res) {
  if (res.status === 429 || res.status >= 500) return true;
  return res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
}

/** @param {unknown} err */
function isNetworkError(err) {
  return err instanceof TypeError || (err instanceof DOMException && ['TimeoutError', 'AbortError'].includes(err.name));
}

/** @param {any[]} raw @returns {Comment[]} */
const toComments = (raw) =>
  raw.map((c) => ({
    id: c.id,
    body: c.body ?? '',
    author: c.user ? { login: c.user.login, avatarUrl: c.user.avatar_url } : null,
    createdAt: c.created_at,
    pending: false,
  }));

/** @param {any[]} raw @returns {Milestone[]} */
const toMilestones = (raw) =>
  raw.map((m) => ({ number: m.number, title: m.title, state: m.state, description: m.description ?? '', dueOn: m.due_on ?? null }));

/** @param {any[]} raw */
const toIssues =(raw) => raw.filter((r) => !r.pull_request).map(toIssue);

export class HttpError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`GitHub answered ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** @param {string | null} link */
function nextPage(link) {
  const url = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  if (!url) return null;
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/** @param {Storage} storage @param {string} key */
function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** @param {Storage} storage @param {string} key @param {unknown} value */
function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the app still works, it just forgets on close.
  }
}
