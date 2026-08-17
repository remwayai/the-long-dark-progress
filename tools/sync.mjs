#!/usr/bin/env node
/* Generate data/board.json for the progress site.
 *
 * Reads the ticket board (GitHub Issues) out of the PRIVATE game repo and writes
 * only the fields that are safe to publish: number, title, stream, state, dates.
 * Issue bodies are NEVER published — they contain the internal audit notes.
 * The one exception is an explicit opt-in: see TEST_RE below.
 *
 * Auth: BOARD_TOKEN (or GITHUB_TOKEN) env var. Locally:
 *   BOARD_TOKEN=$(gh auth token) node tools/sync.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO = process.env.BOARD_REPO || 'remwayai/the-long-dark';
const TOKEN = process.env.BOARD_TOKEN || process.env.GITHUB_TOKEN;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'board.json');

if (!TOKEN) {
  console.error('No BOARD_TOKEN / GITHUB_TOKEN in the environment.');
  process.exit(1);
}

/* An agent asks for a play-test by labelling the issue needs:you and leaving a
   comment that starts with TEST:. Only the text after TEST: is published, so a
   ticket can carry blunt internal notes and still show a clean ask on the page. */
const TEST_RE = /^\s*TEST:\s*/i;

const STREAMS = [
  { key: 'visual',   label: 'Visual' },
  { key: 'gameplay', label: 'Gameplay' },
  { key: 'pipeline', label: 'Art pipeline' },
  { key: 'infra',    label: 'Infrastructure' },
];

const OWNERS = [
  { key: 'opus',  label: 'Opus' },
  { key: 'grok',  label: 'Grok' },
  { key: 'human', label: 'Hiceron' },
];

async function api(path) {
  const out = [];
  let url = `https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (url) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'long-dark-progress-sync',
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${url}`);
    out.push(...(await r.json()));
    const next = (r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return out;
}

const labelNames = (i) => i.labels.map((l) => (typeof l === 'string' ? l : l.name));
const tagged = (i, prefix) => {
  const hit = labelNames(i).find((n) => n.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

/* markdown -> one safe plain-text paragraph. No HTML reaches the page. */
function plain(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

const day = (iso) => iso.slice(0, 10);

function buildBurnup(tickets) {
  if (!tickets.length) return [];
  const created = tickets.map((t) => day(t.created)).sort();
  const start = new Date(`${created[0]}T00:00:00Z`);
  const end = new Date();
  const series = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const stamp = d.toISOString().slice(0, 10);
    series.push({
      date: stamp,
      total: tickets.filter((t) => day(t.created) <= stamp).length,
      closed: tickets.filter((t) => t.closed && day(t.closed) <= stamp).length,
    });
  }
  return series;
}

function roll(defs, tickets, pick) {
  return defs
    .map((d) => {
      const mine = tickets.filter((t) => pick(t) === d.key);
      return {
        key: d.key,
        label: d.label,
        total: mine.length,
        done: mine.filter((t) => t.status === 'done').length,
        in_progress: mine.filter((t) => t.status === 'in_progress').length,
        todo: mine.filter((t) => t.status === 'todo').length,
      };
    })
    .filter((r) => r.total > 0);
}

const issues = (await api(`/repos/${SOURCE_REPO}/issues?state=all`)).filter((i) => !i.pull_request);

const tickets = issues.map((i) => {
  const labels = labelNames(i);
  return {
    number: i.number,
    title: plain(i.title),
    stream: tagged(i, 'stream:') || 'infra',
    owner: tagged(i, 'owner:') || 'opus',
    status: i.state === 'closed' ? 'done' : labels.includes('status:in-progress') ? 'in_progress' : 'todo',
    free: labels.includes('cost:free'),
    // needs:you is added by an agent when the ask is actually ready — a feel gate
    // that nobody has reached yet is future work, not an item in the inbox.
    // Either label puts a ticket in the inbox: Grok reached for needs:playtest and
    // I reached for needs:you within a minute of each other. Both work, no rename.
    needsYou: i.state === 'open' && (labels.includes('needs:you') || labels.includes('needs:playtest')),
    comments: i.comments,
    created: i.created_at,
    updated: i.updated_at,
    closed: i.closed_at,
  };
});

/* The inbox: what an agent is waiting on Hiceron for. */
const inbox = [];
for (const t of tickets.filter((x) => x.needsYou)) {
  let ask = null;
  if (t.comments > 0) {
    const cs = await api(`/repos/${SOURCE_REPO}/issues/${t.number}/comments`);
    const hit = [...cs].reverse().find((c) => TEST_RE.test(c.body || ''));
    if (hit) ask = { text: plain(hit.body.replace(TEST_RE, '')), from: hit.user.login, at: hit.created_at };
  }
  inbox.push({
    number: t.number,
    title: t.title,
    stream: t.stream,
    ask: ask ? ask.text : 'Waiting on a play session — no written ask yet.',
    from: ask ? ask.from : null,
    at: ask ? ask.at : t.updated,
  });
}
inbox.sort((a, b) => new Date(b.at) - new Date(a.at));

const devlog = tickets
  .filter((t) => t.status === 'done')
  .sort((a, b) => new Date(b.closed) - new Date(a.closed))
  .slice(0, 30)
  .map((t) => ({
    number: t.number,
    title: t.title,
    date: t.closed,
    note: `Closed by ${OWNERS.find((o) => o.key === t.owner)?.label || t.owner}. Stream: ${
      STREAMS.find((s) => s.key === t.stream)?.label || t.stream}.`,
  }));

const board = {
  generated: new Date().toISOString(),
  counts: {
    total: tickets.length,
    done: tickets.filter((t) => t.status === 'done').length,
    in_progress: tickets.filter((t) => t.status === 'in_progress').length,
    todo: tickets.filter((t) => t.status === 'todo').length,
    human: tickets.filter((t) => t.owner === 'human' && t.status !== 'done').length,
    free: tickets.filter((t) => t.free && t.status !== 'done').length,
    inbox: inbox.length,
  },
  streams: roll(STREAMS, tickets, (t) => t.stream),
  owners: roll(OWNERS, tickets, (t) => t.owner),
  burnup: buildBurnup(tickets),
  inbox,
  devlog,
  tickets: tickets.map(({ comments, needsYou, free, owner, ...pub }) => ({ ...pub, owner })),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(board, null, 2)}\n`);
console.log(
  `data/board.json — ${board.counts.total} tickets, ${board.counts.done} done, ${inbox.length} waiting on Hiceron`,
);
