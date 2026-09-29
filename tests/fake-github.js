// An in-memory stand-in for the parts of the GitHub REST API the app uses,
// exposed as a `fetch` function. Only the network boundary is faked.

const REPO = '/repos/Tjaronee/Nexus';

/**
 * @param {{ pageSize?: number }} [options]
 */
export function createFakeGitHub({ pageSize = 100 } = {}) {
  /** @type {any[]} */
  const issues = [];
  /** @type {Map<number, any[]>} */
  const comments = new Map();
  /** @type {Map<number, Set<number>>} issue number → blocking issue numbers */
  const blockedBy = new Map();
  /** @type {Map<number, number>} child number → parent number */
  const parents = new Map();
  const milestones = [{ number: 1, title: 'Nieuw huis 2026', state: 'open' }];
  const labels = [
    'prio: low', 'prio: medium', 'prio: high',
    'urgency: now', 'urgency: soon', 'urgency: whenever',
    'Epic', 'boodschappen', 'waar: praxis',
  ].map((name) => ({ name }));
  let nextNumber = 1;
  let clock = Date.parse('2026-09-01T00:00:00Z');

  const state = {
    /** No connection: every request fails before reaching GitHub. */
    offline: false,
    /** The token has expired: every request gets a 401. */
    unauthorized: false,
    /** The next write reaches GitHub, but its response is lost. */
    dropNextResponse: false,
    /** @type {{ method: string, path: string, status: number }[]} */
    log: [],
  };

  const tick = () => new Date((clock += 1000)).toISOString();
  const byNumber = (/** @type {number} */ n) => issues.find((i) => i.number === n);
  const byId = (/** @type {number} */ id) => issues.find((i) => i.id === id);

  /** Seeds an issue directly on the server, as the other partner would. */
  function addIssue(/** @type {Record<string, any>} */ fields = {}) {
    const number = nextNumber++;
    const now = tick();
    /** @type {Record<string, any>} */
    const issue = {
      id: 1000 + number,
      number,
      title: `Issue ${number}`,
      body: '',
      state: 'open',
      state_reason: null,
      labels: [],
      assignees: [],
      milestone: null,
      comments: 0,
      created_at: now,
      updated_at: now,
      closed_at: null,
      ...fields,
    };
    issue.labels = issue.labels.map((/** @type {any} */ l) => (typeof l === 'string' ? { name: l } : l));
    issues.push(issue);
    return issue;
  }

  /** A pull request, which the issues endpoint also returns. */
  function addPullRequest(/** @type {string} */ title) {
    return addIssue({ title, pull_request: { url: 'https://api.github.com/pulls/x' } });
  }

  /** @param {any} issue */
  function present(issue) {
    const parent = parents.get(issue.number);
    const children = [...parents].filter(([, p]) => p === issue.number).map(([c]) => byNumber(c));
    const blockers = [...(blockedBy.get(issue.number) ?? [])];
    return {
      ...issue,
      parent_issue_url: parent ? `https://api.github.com${REPO}/issues/${parent}` : null,
      sub_issues_summary: {
        total: children.length,
        completed: children.filter((c) => c.state === 'closed').length,
      },
      issue_dependencies_summary: {
        blocked_by: blockers.filter((n) => byNumber(n)?.state === 'open').length,
        total_blocked_by: blockers.length,
        blocking: 0,
        total_blocking: 0,
      },
    };
  }

  /** @param {any} issue */
  const touch = (issue) => void (issue.updated_at = tick());

  /** @param {unknown} body */
  const etagOf = (body) => `W/"${hash(JSON.stringify(body))}"`;

  /**
   * @param {number} status
   * @param {unknown} [body]
   * @param {Record<string, string>} [headers]
   */
  const reply = (status, body, headers = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  /** GET with ETag support. @param {Request} req @param {unknown} body @param {Record<string, string>} [headers] */
  function conditional(req, body, headers = {}) {
    const etag = etagOf(body);
    if (req.headers.get('If-None-Match') === etag) return reply(304, undefined, { etag });
    return reply(200, body, { etag, ...headers });
  }

  /** @param {Request} req @param {URL} url */
  function listIssues(req, url) {
    const all = issues
      .filter((i) => url.searchParams.get('state') === 'all' || i.state === (url.searchParams.get('state') ?? 'open'))
      .map(present);
    if (url.searchParams.get('sort') === 'created' && url.searchParams.get('direction') === 'desc') all.reverse();
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 30), pageSize);
    const page = Number(url.searchParams.get('page') ?? 1);
    const items = all.slice((page - 1) * perPage, page * perPage);
    /** @type {Record<string, string>} */
    const headers = {};
    if (page * perPage < all.length) {
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      headers.link = `<${next}>; rel="next"`;
    }
    return conditional(req, items, headers);
  }

  /** @param {Request} req */
  async function route(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;
    const body = m === 'GET' || m === 'HEAD' ? null : await req.json().catch(() => null);
    let match;

    if (m === 'GET' && path === `${REPO}/issues`) return listIssues(req, url);
    if (m === 'GET' && path === `${REPO}/milestones`) return conditional(req, milestones);
    if (m === 'GET' && path === `${REPO}/labels`) return conditional(req, labels);

    if (m === 'POST' && path === `${REPO}/issues`) {
      const issue = addIssue({
        title: body.title,
        body: body.body ?? '',
        labels: body.labels ?? [],
        assignees: (body.assignees ?? []).map((/** @type {string} */ login) => ({ login, avatar_url: `https://avatars/${login}` })),
        milestone: body.milestone ? milestones.find((ms) => ms.number === body.milestone) : null,
      });
      return reply(201, present(issue));
    }

    if ((match = path.match(new RegExp(`^${REPO}/issues/(\\d+)(/.*)?$`)))) {
      const issue = byNumber(Number(match[1]));
      if (!issue) return reply(404, { message: 'Not Found' });
      const rest = match[2] ?? '';

      if (m === 'GET' && rest === '') return conditional(req, present(issue));
      if (m === 'PATCH' && rest === '') {
        for (const key of ['title', 'body', 'state', 'state_reason']) if (key in body) issue[key] = body[key];
        if ('state' in body) issue.closed_at = body.state === 'closed' ? tick() : null;
        if ('milestone' in body) issue.milestone = milestones.find((ms) => ms.number === body.milestone) ?? null;
        touch(issue);
        return reply(200, present(issue));
      }
      if (m === 'POST' && rest === '/labels') {
        for (const name of body.labels) {
          if (!issue.labels.some((/** @type {any} */ l) => l.name === name)) issue.labels.push({ name });
        }
        touch(issue);
        return reply(200, issue.labels);
      }
      if (m === 'DELETE' && (match = rest.match(/^\/labels\/(.+)$/))) {
        const name = decodeURIComponent(match[1]);
        if (!issue.labels.some((/** @type {any} */ l) => l.name === name)) return reply(404, { message: 'Label does not exist' });
        issue.labels = issue.labels.filter((/** @type {any} */ l) => l.name !== name);
        touch(issue);
        return reply(200, issue.labels);
      }
      if (rest === '/assignees' && (m === 'POST' || m === 'DELETE')) {
        const logins = /** @type {string[]} */ (body.assignees);
        issue.assignees = issue.assignees.filter((/** @type {any} */ a) => !logins.includes(a.login));
        if (m === 'POST') issue.assignees.push(...logins.map((login) => ({ login, avatar_url: `https://avatars/${login}` })));
        touch(issue);
        return reply(m === 'POST' ? 201 : 200, present(issue));
      }
      if (rest === '/comments' && m === 'GET') return conditional(req, comments.get(issue.number) ?? []);
      if (rest === '/comments' && m === 'POST') {
        const list = comments.get(issue.number) ?? [];
        const comment = { id: 5000 + list.length, body: body.body, user: { login: 'tjaronee', avatar_url: '' }, created_at: tick() };
        list.push(comment);
        comments.set(issue.number, list);
        issue.comments = list.length;
        touch(issue);
        return reply(201, comment);
      }
      if (rest === '/dependencies/blocked_by' && m === 'GET') {
        return conditional(req, [...(blockedBy.get(issue.number) ?? [])].map((n) => present(byNumber(n))));
      }
      if (rest === '/dependencies/blocked_by' && m === 'POST') {
        const blocker = byId(body.issue_id);
        if (!blocker) return reply(422, { message: 'Validation Failed' });
        blockedBy.set(issue.number, new Set([...(blockedBy.get(issue.number) ?? []), blocker.number]));
        touch(issue);
        return reply(201, present(blocker));
      }
      if (m === 'DELETE' && (match = rest.match(/^\/dependencies\/blocked_by\/(\d+)$/))) {
        const blocker = byId(Number(match[1]));
        const set = blockedBy.get(issue.number);
        if (!blocker || !set?.has(blocker.number)) return reply(404, { message: 'Not Found' });
        set.delete(blocker.number);
        touch(issue);
        return reply(200, present(blocker));
      }
      if (rest === '/sub_issues' && m === 'POST') {
        const child = byId(body.sub_issue_id);
        if (!child) return reply(422, { message: 'Validation Failed' });
        if (parents.has(child.number) && !body.replace_parent) return reply(422, { message: 'Already has a parent' });
        parents.set(child.number, issue.number);
        touch(issue);
        touch(child);
        return reply(201, present(child));
      }
      if (rest === '/sub_issue' && m === 'DELETE') {
        const child = byId(body.sub_issue_id);
        if (!child || parents.get(child.number) !== issue.number) return reply(404, { message: 'Not Found' });
        parents.delete(child.number);
        touch(issue);
        touch(child);
        return reply(200, present(child));
      }
    }
    return reply(404, { message: `No fake route for ${m} ${path}` });
  }

  /** @param {RequestInfo | URL} input @param {RequestInit} [init] */
  async function fetch(input, init) {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname + new URL(req.url).search;
    if (state.offline) {
      state.log.push({ method: req.method, path, status: 0 });
      throw new TypeError('Failed to fetch');
    }
    const res = state.unauthorized ? reply(401, { message: 'Bad credentials' }) : await route(req);
    state.log.push({ method: req.method, path, status: res.status });
    if (req.method !== 'GET' && state.dropNextResponse) {
      state.dropNextResponse = false;
      throw new TypeError('Failed to fetch');
    }
    return res;
  }

  return {
    fetch,
    state,
    issues,
    comments,
    addIssue,
    addPullRequest,
    byNumber,
    /** @param {number} n */
    blockersOf: (n) => [...(blockedBy.get(n) ?? [])],
    /** @param {number} n */
    parentOf: (n) => parents.get(n) ?? null,
    /** @param {number} child @param {number} parent */
    setParent: (child, parent) => void parents.set(child, parent),
    /** @param {number} n @param {number} blocker */
    block: (n, blocker) => void blockedBy.set(n, new Set([...(blockedBy.get(n) ?? []), blocker])),
    /** Requests that reached GitHub (not 304s or offline attempts). */
    writes: () => state.log.filter((e) => e.method !== 'GET' && e.status !== 0),
  };
}

/** @param {string} text */
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
