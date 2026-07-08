// Dashboard: pinned project page + recent activity + open-task summary +
// active pages. All computed — nobody maintains this screen.
import { h, timeago, chip } from '../ui.js';
import { listCommits, listIssues, getFile, listDir } from '../github.js';
import { render, parseFrontMatter } from '../markdown.js';
import { hydrateImages } from './page.js';
import { state } from '../state.js';

export async function renderHome() {
  const [commits, openIssues, pinned, active] = await Promise.all([
    listCommits(15).catch(() => []),
    listIssues('open').catch(() => []),
    getFile('project/dashboard.md').catch(() => null),
    activePages().catch(() => []),
  ]);

  const tasks = openIssues.filter((i) => !i.pull_request);
  const doing = tasks.filter((i) => (i.labels || []).some((l) => l.name === 'doing'));

  // ---- pinned ----
  let pinnedCard = null;
  if (pinned) {
    const md = h('div.md', { html: render(parseFrontMatter(pinned.text).body) });
    hydrateImages(md, 'project/dashboard.md');
    pinnedCard = h('div.card', {},
      h('div', { style: 'display:flex;align-items:baseline' },
        h('h2', {}, '📌 Pinned'),
        h('div.grow'),
        h('a', { href: '#/e/project/dashboard.md', style: 'font-size:13px' }, 'edit')),
      md);
  } else {
    pinnedCard = h('div.card', {},
      h('h2', {}, '📌 Pinned'),
      h('div.hint', {}, 'Create project/dashboard.md and it will appear here — milestones, deadlines, key links.'));
  }

  // ---- activity ----
  const activity = commits.map((c) => h('div.row', {},
    h('div.grow', {},
      c.commit.message.split('\n')[0],
      h('div.sub', {}, `${c.author?.login || c.commit.author.name} · ${timeago(c.commit.author.date)}`)),
  ));

  // ---- active pages by person ----
  const activeRows = active.map((p) => h('div.row', {},
    h('div.grow', {},
      h('a', { href: `#/p/${p.path.split('/').map(encodeURIComponent).join('/')}` },
        p.path.replace(/\.md$/, ''))),
    chip(p.status),
  ));

  return h('div', {},
    h('div.page-head', {}, h('h1', {}, 'Dashboard')),
    h('div.meta-line', {},
      `${tasks.length} open task${tasks.length === 1 ? '' : 's'}, ${doing.length} in progress — `,
      h('a', { href: '#/tasks' }, 'open the board')),
    pinnedCard,
    h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start' },
      h('div.card.rowlist', {},
        h('h2', {}, 'Recent activity'),
        activity.length ? activity : h('div.hint', {}, 'No commits yet.')),
      h('div.card.rowlist', {},
        h('h2', {}, 'Active pages'),
        activeRows.length ? activeRows : h('div.hint', {}, 'Pages with front-matter status: active show up here.')),
    ),
  );
}

async function activePages() {
  const found = [];
  for (const ws of state.workspaces) {
    const entries = await listDir(ws).catch(() => []);
    const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
    const metas = await Promise.all(files.map(async (f) => {
      try {
        const { text } = await getFile(f.path);
        return { path: f.path, status: parseFrontMatter(text).meta.status };
      } catch { return null; }
    }));
    found.push(...metas.filter((m) => m && m.status === 'active'));
  }
  return found;
}
