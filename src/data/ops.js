/**
 * Changes the app makes to Nexus. Each change is a plain, serialisable
 * operation so it can wait in the offline queue. `apply` shows it on screen
 * straight away; `send` makes it happen on GitHub.
 */

import { withCid, matchesRef, avatarOf } from './model.js';

/** @typedef {import('./model.js').Issue} Issue */
/** @typedef {import('./model.js').IssueRef} IssueRef */
/**
 * @typedef {{
 *   type: 'create', cid: string, at: string,
 *   title: string, body: string, labels: string[], assignees: string[], milestone: number | null,
 * }} CreateOp
 */
/**
 * @typedef {(
 *   | CreateOp
 *   | { type: 'update', ref: IssueRef, title?: string, body?: string }
 *   | { type: 'state', ref: IssueRef, state: 'open' | 'closed', reason: StateReason }
 *   | { type: 'labels', ref: IssueRef, add: string[], remove: string[] }
 *   | { type: 'assignees', ref: IssueRef, add: Person[], remove: string[] }
 *   | { type: 'milestone', ref: IssueRef, milestone: MilestoneRef | null }
 *   | { type: 'blockedBy', ref: IssueRef, blocker: IssueRef, add: boolean }
 *   | { type: 'parent', ref: IssueRef, parent: IssueRef | null, previous: IssueRef | null }
 *   | { type: 'comment', ref: IssueRef, body: string, at: string, cid: string }
 * )} Op
 */
/** @typedef {import('./model.js').StateReason} StateReason */
/** @typedef {import('./model.js').Person} Person */
/** @typedef {import('./model.js').MilestoneRef} MilestoneRef */
/** An operation waiting to be sent; `attempted` once a try may have reached GitHub. */
/** @typedef {Op & { attempted?: boolean }} QueuedOp */

/**
 * Shows an operation in a list of issues, without touching GitHub.
 * @param {Issue[]} issues
 * @param {Op} op
 * @returns {Issue[]}
 */
export function apply(issues, op) {
  switch (op.type) {
    case 'create':
      return [...issues, placeholder(op)];
    case 'update':
      return patch(issues, op.ref, (i) => ({
        ...i,
        ...(op.title !== undefined && { title: op.title }),
        ...(op.body !== undefined && { body: op.body }),
      }));
    case 'state':
      return patch(issues, op.ref, (i) => ({
        ...i,
        state: op.state,
        stateReason: op.reason,
        closedAt: op.state === 'closed' ? (i.closedAt ?? new Date().toISOString()) : null,
      }));
    case 'labels':
      return patch(issues, op.ref, (i) => ({
        ...i,
        labels: [...i.labels.filter((l) => !op.remove.includes(l)), ...op.add.filter((l) => !i.labels.includes(l))],
      }));
    case 'assignees':
      return patch(issues, op.ref, (i) => ({
        ...i,
        assignees: [
          ...i.assignees.filter((a) => !op.remove.includes(a.login) && !op.add.some((p) => p.login === a.login)),
          ...op.add,
        ],
      }));
    case 'milestone':
      return patch(issues, op.ref, (i) => ({ ...i, milestone: op.milestone }));
    case 'blockedBy':
      return patch(issues, op.ref, (i) => {
        const others = i.blockedBy.filter((b) => b !== op.blocker);
        const blockedBy = op.add ? [...others, op.blocker] : others;
        return { ...i, blockedBy, blockedByCount: i.blockedByCount + blockedBy.length - i.blockedBy.length };
      });
    case 'parent': {
      const parentNumber = op.parent === null ? null : (find(issues, op.parent)?.number ?? null);
      let next = patch(issues, op.ref, (i) => ({ ...i, parent: parentNumber }));
      if (op.previous !== null) next = patch(next, op.previous, (p) => withSubIssues(p, -1));
      if (parentNumber !== null) next = patch(next, parentNumber, (p) => withSubIssues(p, +1));
      return next;
    }
    case 'comment':
      return patch(issues, op.ref, (i) => ({ ...i, comments: i.comments + 1 }));
  }
}

/** @param {Issue} parent @param {number} delta */
const withSubIssues = (parent, delta) => ({
  ...parent,
  subIssues: { ...parent.subIssues, total: Math.max(0, parent.subIssues.total + delta) },
});

/** @param {Issue[]} issues @param {IssueRef} ref */
const find = (issues, ref) => issues.find((i) => matchesRef(i, ref));

/** How a not-yet-created issue looks until GitHub has it. @param {CreateOp} op @returns {Issue} */
function placeholder(op) {
  return {
    ref: op.cid,
    number: null,
    id: null,
    cid: op.cid,
    title: op.title,
    body: op.body,
    state: 'open',
    stateReason: null,
    labels: op.labels,
    assignees: op.assignees.map((login) => ({ login, avatarUrl: avatarOf(login) })),
    milestone: op.milestone === null ? null : { number: op.milestone, title: '' },
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockedByCount: 0,
    blockedBy: [],
    comments: 0,
    createdAt: op.at,
    updatedAt: op.at,
    closedAt: null,
  };
}

/**
 * @param {Issue[]} issues
 * @param {IssueRef} ref
 * @param {(issue: Issue) => Issue} change
 */
function patch(issues, ref, change) {
  return issues.map((i) => (matchesRef(i, ref) ? change(i) : i));
}

/**
 * @typedef {{
 *   request: (path: string, init?: RequestInit) => Promise<Response>,
 *   repo: string,
 *   resolve: (ref: IssueRef) => Issue | undefined,
 *   labels: () => string[],
 *   labelCreated: (name: string) => void,
 * }} SendContext
 * `labels` are the label names Nexus is known to have; `labelCreated` adds one.
 */

/**
 * Sends an operation to GitHub. Resolves with the updated issue from GitHub's
 * answer when there is one; rejects with a Response when GitHub refuses.
 * @param {QueuedOp} op
 * @param {SendContext} ctx
 * @returns {Promise<any | null>}
 */
export async function send(op, ctx) {
  switch (op.type) {
    case 'create': {
      // An earlier try may have reached GitHub even though we never heard back.
      if (op.attempted) {
        const existing = await findByCid(ctx, op.cid);
        if (existing) return existing;
      }
      await ensureLabels(ctx, op.labels);
      const res = await call(ctx, 'POST', '/issues', {
        title: op.title,
        body: withCid(op.body, op.cid),
        labels: op.labels,
        assignees: op.assignees,
        ...(op.milestone !== null && { milestone: op.milestone }),
      });
      return json(res);
    }
    case 'update': {
      const issue = target(ctx, op.ref);
      /** @type {Record<string, unknown>} */
      const body = {};
      if (op.title !== undefined) body.title = op.title;
      // Keep the hidden client ID, so a later retry can still recognise the issue.
      if (op.body !== undefined) body.body = issue.cid ? withCid(op.body, issue.cid) : op.body;
      return json(await call(ctx, 'PATCH', `/issues/${issue.number}`, body));
    }
    case 'state': {
      const issue = target(ctx, op.ref);
      return json(await call(ctx, 'PATCH', `/issues/${issue.number}`, { state: op.state, state_reason: op.reason }));
    }
    case 'labels': {
      // One label at a time, so labels the partner changed meanwhile survive.
      const issue = target(ctx, op.ref);
      await ensureLabels(ctx, op.add);
      if (op.add.length > 0) await call(ctx, 'POST', `/issues/${issue.number}/labels`, { labels: op.add });
      for (const name of op.remove) {
        await call(ctx, 'DELETE', `/issues/${issue.number}/labels/${encodeURIComponent(name)}`, undefined, [404]);
      }
      return null;
    }
    case 'assignees': {
      const issue = target(ctx, op.ref);
      if (op.remove.length > 0) await call(ctx, 'DELETE', `/issues/${issue.number}/assignees`, { assignees: op.remove });
      if (op.add.length > 0) await call(ctx, 'POST', `/issues/${issue.number}/assignees`, { assignees: op.add.map((p) => p.login) });
      return null;
    }
    case 'milestone': {
      const issue = target(ctx, op.ref);
      return json(await call(ctx, 'PATCH', `/issues/${issue.number}`, { milestone: op.milestone?.number ?? null }));
    }
    case 'blockedBy': {
      const issue = target(ctx, op.ref);
      const blocker = target(ctx, op.blocker);
      const path = `/issues/${issue.number}/dependencies/blocked_by`;
      // After a lost answer, "already exists" means the first try worked.
      if (op.add) await call(ctx, 'POST', path, { issue_id: blocker.id }, op.attempted ? [422] : []);
      else await call(ctx, 'DELETE', `${path}/${blocker.id}`, undefined, [404]);
      return null;
    }
    case 'parent': {
      const child = target(ctx, op.ref);
      if (op.parent !== null) {
        const parent = target(ctx, op.parent);
        const body = { sub_issue_id: child.id, replace_parent: true };
        await call(ctx, 'POST', `/issues/${parent.number}/sub_issues`, body, op.attempted ? [422] : []);
      } else if (op.previous !== null) {
        const previous = target(ctx, op.previous);
        await call(ctx, 'DELETE', `/issues/${previous.number}/sub_issue`, { sub_issue_id: child.id }, [404]);
      }
      return null;
    }
    case 'comment': {
      const issue = target(ctx, op.ref);
      const path = `/issues/${issue.number}/comments`;
      // Like creates: an earlier try may have been posted without us hearing back.
      if (op.attempted) {
        const res = await call(ctx, 'GET', `${path}?per_page=100&since=${encodeURIComponent(op.at)}`);
        const posted = /** @type {any[]} */ (await res.json());
        if (posted.some((c) => c.body?.includes(`<!-- cid:${op.cid} -->`))) return null;
      }
      await call(ctx, 'POST', path, { body: withCid(op.body, op.cid) });
      return null;
    }
  }
}

/**
 * The same operation with every issue it names given by number where known,
 * so it can be applied to what GitHub returns after it was sent.
 * @param {Op} op
 * @param {(ref: IssueRef) => Issue | undefined} resolve
 * @returns {Op}
 */
export function settle(op, resolve) {
  /** @param {IssueRef} ref */
  const num = (ref) => resolve(ref)?.number ?? ref;
  switch (op.type) {
    case 'create':
      return op;
    case 'blockedBy':
      return { ...op, ref: num(op.ref), blocker: num(op.blocker) };
    case 'parent':
      return {
        ...op,
        ref: num(op.ref),
        parent: op.parent === null ? null : num(op.parent),
        previous: op.previous === null ? null : num(op.previous),
      };
    default:
      return { ...op, ref: num(op.ref) };
  }
}

/**
 * Creates the labels Nexus doesn't have yet, such as a new Plek's. One made
 * meanwhile, by the partner say, answers 422 "already exists": that's fine.
 * If GitHub won't create it, the change goes ahead anyway: losing a
 * Boodschap over its label would be worse, and GitHub may still add it.
 * @param {SendContext} ctx
 * @param {string[]} names
 */
async function ensureLabels(ctx, names) {
  const known = ctx.labels().map((l) => l.toLowerCase());
  for (const name of names) {
    if (known.includes(name.toLowerCase())) continue;
    const res = await call(ctx, 'POST', '/labels', { name }, [403, 404, 422]);
    if (isTemporary(res)) throw res;
    if (res.ok || res.status === 422) ctx.labelCreated(name);
  }
}

/** Rate limits and GitHub outages pass; anything else won't succeed on retry. @param {Response} res */
export function isTemporary(res) {
  if (res.status === 429 || res.status >= 500) return true;
  // Primary limit: remaining 0. Secondary limit: a Retry-After header.
  return res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'));
}

/**
 * Looks for an issue carrying this client ID among the newest issues. The
 * list endpoint is used instead of search because search lags behind.
 * @param {SendContext} ctx
 * @param {string} cid
 */
async function findByCid(ctx, cid) {
  const res = await call(ctx, 'GET', '/issues?state=all&sort=created&direction=desc&per_page=50');
  const recent = /** @type {any[]} */ (await res.json());
  return recent.find((raw) => raw.body?.includes(`<!-- cid:${cid} -->`)) ?? null;
}

/** @param {SendContext} ctx @param {IssueRef} ref */
function target(ctx, ref) {
  const issue = ctx.resolve(ref);
  if (!issue?.number || !issue.id) throw new MissingIssueError(ref);
  return /** @type {Issue & { number: number, id: number }} */ (issue);
}

export class MissingIssueError extends Error {
  /** @param {IssueRef} ref */
  constructor(ref) {
    super(`Issue ${ref} is not known`);
    this.name = 'MissingIssueError';
  }
}

/**
 * @param {SendContext} ctx
 * @param {string} method
 * @param {string} path relative to the repo
 * @param {unknown} [body]
 * @param {number[]} [alsoFine] statuses that mean "already so", like 404 when removing a label
 */
async function call(ctx, method, path, body, alsoFine = []) {
  const res = await ctx.request(`${ctx.repo}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && !alsoFine.includes(res.status)) throw res;
  return res;
}

/** @param {Response} res */
const json = (res) => res.json();
