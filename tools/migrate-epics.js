// One-off data migration for Nexus ADR 0004: the Epics that were really
// goals become Mijlpalen, their Taken move into them, and every Epic is
// retired. Run `node tools/migrate-epics.js` for a dry run that only prints
// the plan; add `--apply` to carry it out. The plan is worked out from the
// current data each time, so a rerun only does what is still left.
// The token comes from GITHUB_TOKEN, or else from `gh auth token`.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createGitHub } from '../src/github.js';
import { GITHUB_API, NEXUS_OWNER, NEXUS_REPO } from '../src/config.js';

const REPO = `/repos/${NEXUS_OWNER}/${NEXUS_REPO}`;
const EPIC_LABEL = 'Epic';
// The goal Epics, each with the Mijlpaal it becomes. Fixed numbers rather
// than the label, because the label is gone after a run; the titles guard
// against a renamed Epic quietly producing a wrongly named Mijlpaal.
/** @type {Map<number, string>} */
const PROMOTED = new Map([
  [12, 'Verkoop eigen woning'],
  [15, 'Koopcontract nieuwe huis'],
  [24, 'Verhuizen'],
]);
// "Taken nieuwe huis" was only a bucket: it is closed, and its Taken keep
// the Mijlpaal they already have.
const RETIRED = [37];

/** @typedef {ReturnType<typeof createGitHub>} GitHub */
/** @typedef {{ number: number, title: string, description: string | null }} Milestone */
/** @typedef {{ number: number, title: string, body: string | null, state: string, milestone: Milestone | null, labels: { name: string }[] }} Issue */
/**
 * @typedef {(
 *   | { kind: 'create-milestone', title: string, description: string }
 *   | { kind: 'describe-milestone', number: number, title: string, description: string }
 *   | { kind: 'move', issue: Issue, to: string }
 *   | { kind: 'close', issue: Issue }
 *   | { kind: 'unlabel', issue: Issue }
 * )} Change
 */

/**
 * @param {GitHub} github
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function call(github, path, { method = 'GET', body } = {}) {
  const res = await github.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Every item of a list endpoint, following the `Link` header. @param {GitHub} github @param {string} path */
async function all(github, path) {
  /** @type {any[]} */
  const items = [];
  /** @type {string | null} */
  let next = path;
  while (next) {
    const res = await github.request(next);
    if (!res.ok) throw new Error(`GET ${next} failed: ${res.status} ${await res.text()}`);
    items.push(...(await res.json()));
    const link = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    next = link ? link.slice(GITHUB_API.length) : null;
  }
  return items;
}

/** The issue and all its sub-issues, depth first. @param {GitHub} github @param {number} number */
async function descendants(github, number, seen = new Set([number])) {
  /** @type {Issue[]} */
  const found = [];
  for (const child of await all(github, `${REPO}/issues/${number}/sub_issues?per_page=100`)) {
    if (seen.has(child.number)) continue;
    seen.add(child.number);
    found.push(child, ...(await descendants(github, child.number, seen)));
  }
  return found;
}

// Line endings are normalised because Epic bodies typed on github.com use
// CRLF; comparing them raw could make every rerun see a changed description.
/** A text as a Mijlpaal description. @param {string | null | undefined} text */
const descriptionOf = (text) => (text ?? '').replace(/\r\n/g, '\n').trim();

/**
 * Works out what is still left to do, from the data as it is now.
 * @param {GitHub} github
 * @returns {Promise<{ changes: Change[], milestoneNumbers: Map<string, number> }>}
 */
async function plan(github) {
  /** @type {Milestone[]} */
  const milestones = await all(github, `${REPO}/milestones?state=all&per_page=100`);
  /** @type {Change[]} */
  const creates = [];
  /** @type {Change[]} */
  const moves = [];
  /** @type {Change[]} */
  const closes = [];

  /** @type {Map<number, Issue>} */
  const epics = new Map();
  for (const number of [...PROMOTED.keys(), ...RETIRED]) epics.set(number, await call(github, `${REPO}/issues/${number}`));

  for (const [number, title] of PROMOTED) {
    const epic = /** @type {Issue} */ (epics.get(number));
    if (epic.title !== title) throw new Error(`Expected #${number} to be "${title}", found "${epic.title}"; nothing changed`);
    const description = descriptionOf(epic.body);
    const existing = milestones.find((ms) => ms.title === title);
    if (!existing) creates.push({ kind: 'create-milestone', title, description });
    else if (descriptionOf(existing.description) !== description) {
      creates.push({ kind: 'describe-milestone', number: existing.number, title, description });
    }
    for (const issue of await descendants(github, number)) {
      if (issue.milestone?.title !== title) moves.push({ kind: 'move', issue, to: title });
    }
  }
  for (const epic of epics.values()) {
    if (epic.state === 'open') closes.push({ kind: 'close', issue: epic });
  }
  // The issues endpoint also returns pull requests; only issues are migrated.
  /** @type {(Issue & { pull_request?: unknown })[]} */
  const labelled = (await all(github, `${REPO}/issues?labels=${EPIC_LABEL}&state=all&per_page=100`)).filter(
    (item) => !item.pull_request,
  );
  // An open Epic this script does not know about would lose its label but
  // stay open, showing up in the app as a Taak; better to stop and look.
  const unknown = labelled.filter((issue) => issue.state === 'open' && !epics.has(issue.number));
  if (unknown.length > 0) {
    throw new Error(`Unexpected open Epics ${unknown.map(ref).join(', ')}; nothing changed`);
  }
  /** @type {Change[]} */
  const unlabels = labelled
    .sort((a, b) => a.number - b.number)
    .map((issue) => ({ kind: 'unlabel', issue }));
  return {
    changes: [...creates, ...moves, ...closes, ...unlabels],
    milestoneNumbers: new Map(milestones.map((ms) => [ms.title, ms.number])),
  };
}

/** @param {Issue} issue */
const ref = (issue) => `#${issue.number} "${issue.title}"`;

/** One line per change, for the dry run and the apply log. @param {Change} change */
export function describe(change) {
  switch (change.kind) {
    case 'create-milestone':
      return `Create Mijlpaal "${change.title}" with ${change.description ? `description ${JSON.stringify(change.description)}` : 'no description'}`;
    case 'describe-milestone':
      return `Set description of Mijlpaal "${change.title}" to ${JSON.stringify(change.description)}`;
    case 'move': {
      const from = change.issue.milestone ? `"${change.issue.milestone.title}"` : 'no Mijlpaal';
      return `Move ${ref(change.issue)} from ${from} to "${change.to}"`;
    }
    case 'close':
      return `Close ${ref(change.issue)} as not planned`;
    case 'unlabel':
      return `Remove label ${EPIC_LABEL} from ${ref(change.issue)}`;
  }
}

/**
 * @param {GitHub} github
 * @param {Change} change
 * @param {Map<string, number>} numbers Mijlpaal title → number, filled as Mijlpalen are created
 */
async function carryOut(github, change, numbers) {
  switch (change.kind) {
    case 'create-milestone': {
      const created = await call(github, `${REPO}/milestones`, {
        method: 'POST',
        body: { title: change.title, description: change.description },
      });
      numbers.set(change.title, created.number);
      return;
    }
    case 'describe-milestone':
      await call(github, `${REPO}/milestones/${change.number}`, { method: 'PATCH', body: { description: change.description } });
      return;
    case 'move': {
      const milestone = numbers.get(change.to);
      if (milestone === undefined) throw new Error(`No Mijlpaal "${change.to}" to move ${ref(change.issue)} into`);
      await call(github, `${REPO}/issues/${change.issue.number}`, { method: 'PATCH', body: { milestone } });
      return;
    }
    case 'close':
      await call(github, `${REPO}/issues/${change.issue.number}`, {
        method: 'PATCH',
        body: { state: 'closed', state_reason: 'not_planned' },
      });
      return;
    case 'unlabel': {
      const res = await github.request(`${REPO}/issues/${change.issue.number}/labels/${encodeURIComponent(EPIC_LABEL)}`, {
        method: 'DELETE',
      });
      // 404: the label was already gone, which is the goal anyway.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Removing ${EPIC_LABEL} from ${ref(change.issue)} failed: ${res.status} ${await res.text()}`);
      }
      return;
    }
  }
}

/**
 * Plans the migration and, with `apply`, carries it out change by change.
 * @param {{ github: GitHub, apply: boolean, log: (line: string) => void }} options
 * @returns {Promise<Change[]>} the planned changes
 */
export async function migrate({ github, apply, log }) {
  const { changes, milestoneNumbers } = await plan(github);
  if (changes.length === 0) {
    log('Nothing left to do.');
    return changes;
  }
  if (!apply) {
    for (const change of changes) log(describe(change));
    log(`Dry run: ${changes.length} changes planned, nothing changed. Run with --apply to make them.`);
    return changes;
  }
  for (const change of changes) {
    await carryOut(github, change, milestoneNumbers);
    log(describe(change));
  }
  log(`Applied ${changes.length} changes.`);
  return changes;
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const github = createGitHub({ token: token(), onUnauthorized: () => {} });
  migrate({ github, apply: process.argv.includes('--apply'), log: (line) => console.log(line) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
