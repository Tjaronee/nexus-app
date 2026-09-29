/**
 * The app's view of a Nexus issue, and the domain rules read from its labels.
 * See Nexus ADR 0001 (labels are the source of truth) and ADR 0003.
 */

/** @typedef {{ login: string, avatarUrl: string }} Person */
/** @typedef {{ number: number, title: string }} MilestoneRef */
/**
 * An issue as the screens see it. `number` is null while a create is still
 * waiting to be sent; `ref` is then the client ID, and afterwards the number.
 * @typedef {{
 *   ref: IssueRef,
 *   number: number | null,
 *   id: number | null,
 *   cid: string | null,
 *   title: string,
 *   body: string,
 *   state: 'open' | 'closed',
 *   stateReason: StateReason | null,
 *   labels: string[],
 *   assignees: Person[],
 *   milestone: MilestoneRef | null,
 *   parent: number | null,
 *   subIssues: { total: number, completed: number },
 *   blockedByCount: number,
 *   blockedBy: IssueRef[],
 *   comments: number,
 *   createdAt: string,
 *   updatedAt: string,
 *   closedAt: string | null,
 * }} Issue
 */
/** @typedef {number | string} IssueRef Issue number, or client ID for an issue not created yet. */
/** @typedef {'completed' | 'not_planned' | 'reopened'} StateReason */
/** @typedef {'taak' | 'epic' | 'boodschap'} Kind */
/** @typedef {'laag' | 'middel' | 'hoog'} Prio */
/** @typedef {'nu' | 'binnenkort' | 'ooit'} Urgentie */

export const BOODSCHAPPEN_LABEL = 'boodschappen';
export const EPIC_LABEL = 'Epic';

/** @type {Record<Prio, string>} */
export const PRIO_LABELS = { laag: 'prio: low', middel: 'prio: medium', hoog: 'prio: high' };
/** @type {Record<Urgentie, string>} */
export const URGENTIE_LABELS = { nu: 'urgency: now', binnenkort: 'urgency: soon', ooit: 'urgency: whenever' };

const CID_MARKER = /\s*<!-- cid:([\w-]+) -->\s*$/;

/** @param {string} body @param {string} cid */
export function withCid(body, cid) {
  return `${body}\n\n<!-- cid:${cid} -->`;
}

/**
 * Whether `ref` names this issue: by number, or by the client ID it was created with.
 * @param {Issue} issue
 * @param {IssueRef} ref
 */
export function matchesRef(issue, ref) {
  return issue.ref === ref || (issue.cid !== null && issue.cid === ref);
}

/** Separates the hidden client ID from the visible text. @param {string | null | undefined} body */
export function splitCid(body) {
  const text = body ?? '';
  const match = text.match(CID_MARKER);
  return match ? { body: text.slice(0, match.index), cid: match[1] } : { body: text, cid: null };
}

/**
 * Converts an issue from the GitHub REST API.
 * @param {any} raw
 * @returns {Issue}
 */
export function toIssue(raw) {
  const { body, cid } = splitCid(raw.body);
  const parentUrl = /** @type {string | null | undefined} */ (raw.parent_issue_url);
  return {
    ref: raw.number,
    number: raw.number,
    id: raw.id,
    cid,
    title: raw.title,
    body,
    state: raw.state,
    stateReason: raw.state_reason ?? null,
    labels: (raw.labels ?? []).map((/** @type {any} */ l) => (typeof l === 'string' ? l : l.name)),
    assignees: (raw.assignees ?? []).map((/** @type {any} */ a) => ({ login: a.login, avatarUrl: a.avatar_url })),
    milestone: raw.milestone ? { number: raw.milestone.number, title: raw.milestone.title } : null,
    parent: parentUrl ? Number(parentUrl.split('/').pop()) : null,
    subIssues: {
      total: raw.sub_issues_summary?.total ?? 0,
      completed: raw.sub_issues_summary?.completed ?? 0,
    },
    blockedByCount: raw.issue_dependencies_summary?.total_blocked_by ?? 0,
    blockedBy: [],
    comments: raw.comments ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
  };
}

/** @param {Issue} issue @returns {Kind} */
export function kindOf(issue) {
  if (issue.labels.includes(BOODSCHAPPEN_LABEL)) return 'boodschap';
  if (issue.labels.includes(EPIC_LABEL) || issue.subIssues.total > 0) return 'epic';
  return 'taak';
}

/**
 * The open issues this one is blocking, found by reversing their blocked-by lists.
 * @param {Issue[]} issues
 * @param {Issue} issue
 */
export function blocking(issues, issue) {
  return issues.filter((other) => other.state === 'open' && other.blockedBy.some((ref) => matchesRef(issue, ref)));
}

/**
 * @template {string} V
 * @param {Issue} issue
 * @param {Record<V, string>} labels
 * @param {V} fallback
 * @returns {V}
 */
function valueFromLabels(issue, labels, fallback) {
  const entries = /** @type {[V, string][]} */ (Object.entries(labels));
  return entries.find(([, label]) => issue.labels.includes(label))?.[0] ?? fallback;
}

/** Unlabelled issues count as middel, without writing the label. @param {Issue} issue */
export const prioOf = (issue) => valueFromLabels(issue, PRIO_LABELS, /** @type {Prio} */ ('middel'));

/** Unlabelled issues count as binnenkort, without writing the label. @param {Issue} issue */
export const urgentieOf = (issue) => valueFromLabels(issue, URGENTIE_LABELS, /** @type {Urgentie} */ ('binnenkort'));
