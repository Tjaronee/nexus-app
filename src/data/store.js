import { NEXUS_OWNER, NEXUS_REPO } from '../config.js';
import { UnauthorizedError } from '../github.js';
import { toIssue, matchesRef, splitCid, avatarOf, PRIO_LABELS, URGENTIE_LABELS } from './model.js';
import { apply, send, settle, isTemporary, MissingIssueError } from './ops.js';

/** @typedef {import('./model.js').Issue} Issue */
/** @typedef {import('./model.js').IssueRef} IssueRef */
/** @typedef {import('./model.js').Person} Person */
/** @typedef {import('./model.js').Prio} Prio */
/** @typedef {import('./model.js').Urgentie} Urgentie */
/**
 * `issueCount` is GitHub's own count of the issues and pull requests that
 * have it; a Mijlpaal cached by an older version doesn't have it yet.
 * @typedef {{ number: number, title: string, state: 'open' | 'closed', description: string, dueOn: string | null, issueCount?: number }} Milestone
 */
/** @typedef {{ title?: string, description?: string, state?: 'open' | 'closed' }} MijlpaalFields */
/** @typedef {{ type: 'mijlpaal', action: 'create' | 'edit' | 'delete', number: number | null }} MijlpaalChange */
/** @typedef {{ type: 'label', action: 'create' | 'delete', name: string }} LabelChange */
/**
 * How an online-only change went: GitHub has it, GitHub refused it (the
 * failure banner says so), or there was no connection and nothing happened.
 * @typedef {'saved' | 'refused' | 'offline'} ChangeResult
 */
/** @typedef {ChangeResult} MijlpaalResult */
/** @typedef {{ id: number | null, body: string, author: Person | null, createdAt: string, pending: boolean }} Comment */
/** @typedef {import('./ops.js').Op} Op */
/** @typedef {import('./ops.js').QueuedOp} QueuedOp */
/** @typedef {ReturnType<import('../github.js').createGitHub>} GitHub */
/** @typedef {{ etag: string, body: any, next: string | null }} CachedResponse */

const REPO = `/repos/${NEXUS_OWNER}/${NEXUS_REPO}`;
const CACHE_KEY = 'nexus.cache';
const QUEUE_KEY = 'nexus.queue';
const MILESTONES_PATH = `${REPO}/milestones?state=all&per_page=100`;
const LABELS_PATH = `${REPO}/labels?per_page=100`;
const ISSUES_PATH = `${REPO}/issues?state=all&per_page=100&sort=created&direction=asc`;

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
  // Mijlpalen cached by an older version lack issueCount, and a 304 would
  // keep them that way: fetch them in full once.
  if (milestones.some((m) => m.issueCount === undefined)) responses.delete(MILESTONES_PATH);
  /** @type {QueuedOp[]} */
  let queue = withoutRetiredOps(readJson(storage, QUEUE_KEY) ?? []);
  let online = true;
  /** Bumped by every write GitHub accepted; a refresh that overlaps one is stale. */
  let acceptedWrites = 0;
  /** Whether GitHub has answered a refresh since the app opened, so `base` is current. */
  let refreshed = false;
  /** @type {Issue[] | null} */
  let view = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Promise<void> | null} */
  let flushing = null;
  /** @type {Promise<void> | null} */
  let flushAgain = null;
  /** Changes GitHub refused, so the screen can say they didn't happen. */
  /** @type {{ op: Op | MijlpaalChange | LabelChange, status: number }[]} */
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
    const issue = issues().find((i) => matchesRef(i, ref));
    if (!issue) return [];
    const loaded = (issue.number && loadedComments.get(issue.number)) || [];
    const waiting = queue.flatMap((op) =>
      op.type === 'comment' && matchesRef(issue, op.ref)
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
    // Comments are only kept for the session; the rest is what the app opens with.
    const kept = [...responses].filter(([path]) => !path.includes('/comments'));
    writeJson(storage, CACHE_KEY, { issues: base, milestones, labels, responses: kept });
  }

  function persistQueue() {
    if (writeJson(storage, QUEUE_KEY, queue)) return;
    // Storage is full. Waiting changes matter more than the cache: drop it and retry.
    try {
      storage.removeItem(CACHE_KEY);
    } catch {
      // Storage is blocked altogether; the queue then lives only in memory.
    }
    writeJson(storage, QUEUE_KEY, queue);
  }

  /** @param {Op} op */
  function enqueue(op) {
    queue = [...queue, op];
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
    const current = issues().find((i) => matchesRef(i, ref))?.labels ?? [];
    const others = Object.values(labels).filter((l) => l !== labels[value] && current.includes(/** @type {string} */ (l)));
    enqueue({ type: 'labels', ref, add: [labels[value]], remove: /** @type {string[]} */ (others) });
  }

  /** A person by login, with their avatar if we have seen it. @param {string} login @returns {Person} */
  function person(login) {
    const known = issues().flatMap((i) => i.assignees).find((a) => a.login === login && a.avatarUrl);
    return known ?? { login, avatarUrl: avatarOf(login) };
  }

  /** @param {IssueRef} ref */
  const resolve = (ref) => base.find((i) => matchesRef(i, ref));

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
      try {
        while (queue.length > 0) {
          const outcome = await sendOne(queue[0]);
          if (outcome === 'retry') return;
          queue = queue.slice(1);
          persistQueue();
          changed();
        }
      } catch (err) {
        // A bug, not GitHub: keep the change queued and try again next sync.
        console.error('Sending a change failed', err);
      }
    })();
    flushing = run;
    void run.then(() => {
      if (flushing === run) flushing = null;
    });
    return run;
  }

  /** @param {QueuedOp} op @returns {Promise<'done' | 'dropped' | 'retry'>} */
  async function sendOne(op) {
    if (!op.attempted) {
      // Remember the try before making it: if the answer is lost, the next
      // try first checks whether GitHub already has the change.
      queue = [{ ...op, attempted: true }, ...queue.slice(1)];
      persistQueue();
    }
    try {
      const raw = await send(op, {
        request: github.request,
        repo: REPO,
        resolve,
        labels: () => labels,
        labelCreated: (name) => {
          labels = [...labels, name];
        },
      });
      online = true;
      acceptedWrites++;
      if (raw) upsert(raw);
      else base = apply(base, settle(op, resolve));
      persistCache();
      if (op.type === 'comment') await loadComments(op.ref).catch(() => {});
      return 'done';
    } catch (err) {
      if (err instanceof UnauthorizedError) return 'retry';
      // Not knowing the issue only means it's gone once we have fresh data.
      if (err instanceof MissingIssueError && !refreshed) return 'retry';
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

  /**
   * Sends a change to Mijlpalen or labels. Unlike issue changes these are not
   * queued: they are rare, and the queue is built around issues. So the
   * change happens now or not at all, and the lists only change once GitHub
   * has it. Returns GitHub's answer when it accepted the change.
   * @param {MijlpaalChange | LabelChange} change
   * @param {string} path
   * @param {'POST' | 'PATCH' | 'DELETE'} method
   * @param {Record<string, string>} [fields]
   * @returns {Promise<Response | 'refused' | 'offline'>}
   */
  async function sendNow(change, path, method, fields) {
    let res;
    try {
      res = await github.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: fields === undefined ? undefined : JSON.stringify(fields),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // An expired token is handled by the client's onUnauthorized.
      if (err instanceof UnauthorizedError) return 'refused';
      if (!isNetworkError(err)) throw err;
      online = false;
      changed();
      return 'offline';
    }
    online = true;
    if (!res.ok) {
      failed = [...failed, { op: change, status: res.status }];
      changed();
      return 'refused';
    }
    // A refresh under way may have read the lists before this change; it
    // must not put the old ones back.
    acceptedWrites++;
    return res;
  }

  /**
   * Creates, edits or deletes a Mijlpaal.
   * @param {MijlpaalChange} change
   * @param {'POST' | 'PATCH' | 'DELETE'} method
   * @param {Record<string, string>} [fields]
   * @returns {Promise<ChangeResult>}
   */
  async function changeMijlpaal(change, method, fields) {
    const res = await sendNow(change, `${REPO}/milestones${change.number === null ? '' : `/${change.number}`}`, method, fields);
    if (typeof res === 'string') return res;
    responses.delete(MILESTONES_PATH);
    if (method === 'DELETE') {
      milestones = milestones.filter((m) => m.number !== change.number);
    } else {
      // GitHub has it even if its answer breaks off; the refresh below brings it.
      const saved = await res.json().then(toMilestone, () => null);
      if (saved) milestones = [...milestones.filter((m) => m.number !== saved.number), saved].sort(byNumber);
    }
    persistCache();
    changed();
    // Issues show their Mijlpaal's title too, so fetch both. A refresh under
    // way drops its answer for this change, so a new one follows it.
    void (refreshing ?? Promise.resolve()).then(refresh);
    return 'saved';
  }

  /**
   * Creates or deletes a label in Nexus, such as a Soort's or a Plek's.
   * @param {LabelChange} change
   * @returns {Promise<ChangeResult>}
   */
  async function changeLabel(change) {
    const { action, name } = change;
    const res =
      action === 'create'
        ? await sendNow(change, `${REPO}/labels`, 'POST', { name })
        : await sendNow(change, `${REPO}/labels/${encodeURIComponent(name)}`, 'DELETE');
    if (typeof res === 'string') return res;
    responses.delete(LABELS_PATH);
    if (action === 'create') {
      labels = [...labels.filter((l) => l !== name), name];
    } else {
      labels = labels.filter((l) => l !== name);
      // GitHub takes it off every issue, closed ones too; show that at once.
      // Their pages' ETags change with it, so the refresh fetches them anew.
      base = base.map((i) => (i.labels.includes(name) ? { ...i, labels: i.labels.filter((l) => l !== name) } : i));
    }
    persistCache();
    changed();
    // A refresh under way drops its answer for this change, so a new one follows it.
    void (refreshing ?? Promise.resolve()).then(refresh);
    return 'saved';
  }

  /** @type {Promise<void> | null} */
  let refreshing = null;

  /** Fetches what changed on GitHub. Overlapping calls share one refresh. */
  function refresh() {
    refreshing ??= refreshOnce().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function refreshOnce() {
    const writesBefore = acceptedWrites;
    /** @type {string[]} */
    const paths = [];
    try {
      /** @type {Issue[]} */
      const fetched = [];
      let anyChanged = false;
      /** @type {string | null} */
      let path = ISSUES_PATH;
      while (path) {
        paths.push(path);
        const page = await conditionalGet(path, toIssues);
        fetched.push(...page.body);
        anyChanged ||= page.changed;
        path = page.next;
      }
      paths.push(MILESTONES_PATH);
      const ms = await conditionalGet(MILESTONES_PATH, toMilestones);
      paths.push(LABELS_PATH);
      const ls = await conditionalGet(LABELS_PATH, (raw) => raw.map((/** @type {any} */ l) => l.name));
      const fresh = anyChanged ? await withBlockers(fetched) : null;
      online = true;
      if (acceptedWrites !== writesBefore) {
        // A write landed meanwhile, so this answer may predate it. Forget
        // the ETags so the next refresh fetches the new state in full.
        for (const p of paths) responses.delete(p);
      } else {
        if (fresh) base = fresh;
        milestones = ms.body;
        labels = ls.body;
      }
      refreshed = true;
      if (queue.length > 0) void flush();
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
      // Online-only actions are disabled at once, not after their first failure.
      const offline = () => {
        online = false;
        changed();
      };
      win.addEventListener('online', sync);
      win.addEventListener('offline', offline);
      sync();
      return () => {
        clearInterval(timer);
        doc.removeEventListener('visibilitychange', onVisible);
        win.removeEventListener('online', sync);
        win.removeEventListener('offline', offline);
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
    comment: (ref, body) => enqueue({ type: 'comment', ref, body, at: new Date().toISOString(), cid: newId() }),
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
    /**
     * A new Mijlpaal. The app sets no due date (Nexus ADR 0004).
     * @param {{ title: string, description: string }} fields
     */
    createMijlpaal: ({ title, description }) =>
      changeMijlpaal({ type: 'mijlpaal', action: 'create', number: null }, 'POST', { title, description }),
    /** Edits it; `state: 'closed'` is Afronden, `'open'` Heropenen. @param {number} number @param {MijlpaalFields} fields */
    editMijlpaal: (number, fields) => changeMijlpaal({ type: 'mijlpaal', action: 'edit', number }, 'PATCH', fields),
    /** Only for a Mijlpaal no issue has: GitHub would strip it from them. @param {number} number */
    deleteMijlpaal: (number) => changeMijlpaal({ type: 'mijlpaal', action: 'delete', number }, 'DELETE'),
    /**
     * A new label in Nexus, such as `soort: klusjes`. Online only, like Mijlpalen.
     * @param {string} name
     */
    createLabel: (name) => changeLabel({ type: 'label', action: 'create', name }),
    /**
     * Deletes a label from Nexus, such as a Soort's or a Plek's. GitHub takes
     * it off every issue, closed ones too.
     * @param {string} name exactly as the label is written
     */
    deleteLabel: (name) => changeLabel({ type: 'label', action: 'delete', name }),
    /** @param {IssueRef} ref @param {number | null} number */
    setMilestone: (ref, number) =>
      enqueue({
        type: 'milestone',
        ref,
        milestone: number === null ? null : { number, title: milestones.find((m) => m.number === number)?.title ?? '' },
      }),
  };
}

/** @param {unknown} err */
function isNetworkError(err) {
  return err instanceof TypeError || (err instanceof DOMException && ['TimeoutError', 'AbortError'].includes(err.name));
}

/** @param {any[]} raw @returns {Comment[]} */
const toComments = (raw) =>
  raw.map((c) => ({
    id: c.id,
    body: splitCid(c.body).body,
    author: c.user ? { login: c.user.login, avatarUrl: c.user.avatar_url } : null,
    createdAt: c.created_at,
    pending: false,
  }));

/** @param {any} m @returns {Milestone} */
const toMilestone = (m) => ({
  number: m.number,
  title: m.title,
  state: m.state,
  description: m.description ?? '',
  dueOn: m.due_on ?? null,
  issueCount: (m.open_issues ?? 0) + (m.closed_issues ?? 0),
});

/** @param {any[]} raw @returns {Milestone[]} */
const toMilestones = (raw) => raw.map(toMilestone);

/** @param {Milestone} a @param {Milestone} b */
const byNumber = (a, b) => a.number - b.number;

/** @param {any[]} raw */
const toIssues = (raw) => raw.filter((r) => !r.pull_request).map(toIssue);

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

/**
 * Drops queued changes of a kind the app no longer makes. An older version
 * could still have a sub-issue move waiting on the device; it can't be shown
 * or sent any more, and Nexus doesn't need it (Nexus ADR 0004).
 * @param {any[]} queue
 * @returns {QueuedOp[]}
 */
function withoutRetiredOps(queue) {
  return queue.filter((op) => op?.type !== 'parent');
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
    return true;
  } catch {
    // Full or blocked storage: the app still works, it just forgets on close.
    return false;
  }
}
