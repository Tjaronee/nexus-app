import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIssue, kindOf, prioOf, urgentieOf, blocking } from '../src/data/model.js';

/** A GitHub REST issue as the list endpoint returns it. @param {Record<string, any>} [over] */
function raw(over = {}) {
  return {
    id: 1001,
    number: 7,
    title: 'Meubels opmeten',
    body: 'Woonkamer en slaapkamer',
    state: 'open',
    state_reason: null,
    labels: [{ name: 'prio: high' }, { name: 'urgency: now' }],
    assignees: [{ login: 'tjaronee', avatar_url: 'https://avatars/t.png' }],
    milestone: { number: 1, title: 'Nieuw huis 2026' },
    parent_issue_url: 'https://api.github.com/repos/Tjaronee/Nexus/issues/24',
    sub_issues_summary: { total: 0, completed: 0 },
    issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 2, blocking: 0, total_blocking: 0 },
    comments: 3,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    closed_at: null,
    ...over,
  };
}

test('reads the fields the screens need from a GitHub issue', () => {
  const issue = toIssue(raw());
  assert.equal(issue.number, 7);
  assert.equal(issue.ref, 7);
  assert.equal(issue.title, 'Meubels opmeten');
  assert.deepEqual(issue.labels, ['prio: high', 'urgency: now']);
  assert.deepEqual(issue.assignees, [{ login: 'tjaronee', avatarUrl: 'https://avatars/t.png' }]);
  assert.deepEqual(issue.milestone, { number: 1, title: 'Nieuw huis 2026' });
  assert.equal(issue.parent, 24);
  assert.equal(issue.blockedByCount, 2);
});

test('hides the client ID in the body and exposes it separately', () => {
  const issue = toIssue(raw({ body: 'melk halen\n\n<!-- cid:abc-123 -->' }));
  assert.equal(issue.body, 'melk halen');
  assert.equal(issue.cid, 'abc-123');
});

test('issues labelled boodschappen are Boodschappen', () => {
  assert.equal(kindOf(toIssue(raw({ labels: [{ name: 'boodschappen' }, { name: 'waar: praxis' }] }))), 'boodschap');
});

test('issues labelled Epic, or with sub-issues, are Epics', () => {
  assert.equal(kindOf(toIssue(raw({ labels: [{ name: 'Epic' }] }))), 'epic');
  assert.equal(kindOf(toIssue(raw({ labels: [], sub_issues_summary: { total: 2, completed: 1 } }))), 'epic');
});

test('every other issue is a Taak', () => {
  assert.equal(kindOf(toIssue(raw())), 'taak');
  assert.equal(kindOf(toIssue(raw({ labels: [] }))), 'taak');
});

test('maps prio and urgency labels to Dutch values', () => {
  const issue = toIssue(raw({ labels: [{ name: 'prio: low' }, { name: 'urgency: whenever' }] }));
  assert.equal(prioOf(issue), 'laag');
  assert.equal(urgentieOf(issue), 'ooit');
  const high = toIssue(raw());
  assert.equal(prioOf(high), 'hoog');
  assert.equal(urgentieOf(high), 'nu');
});

test('lists the open issues a Taak is blocking', () => {
  const busje = { ...toIssue(raw({ number: 27 })), blockedBy: [] };
  const verhuizen = { ...toIssue(raw({ number: 30 })), blockedBy: [27, 28] };
  const dozen = { ...toIssue(raw({ number: 28 })), blockedBy: [] };
  assert.deepEqual(blocking([busje, verhuizen, dozen], busje).map((i) => i.number), [30]);
  assert.deepEqual(blocking([busje, verhuizen, dozen], verhuizen), []);
});

test('unlabelled issues count as middel / binnenkort', () => {
  const issue = toIssue(raw({ labels: [] }));
  assert.equal(prioOf(issue), 'middel');
  assert.equal(urgentieOf(issue), 'binnenkort');
});
