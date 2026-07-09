// Dashboard: pinned project page + recent activity + open-task summary +
// active pages. All computed — nobody maintains this screen.
// Renders its scaffold immediately; each card fills in as its data lands,
// and the active-pages sweep (a getFile per page) streams rows as it goes.
import { h, clear, timeago, chip, skeleton, slot } from '../ui.js';
import { listCommits, listIssues, getFile, listDir } from '../github.js';
import { render, parseFrontMatter } from '../markdown.js';
import { hydrateImages } from './page.js';
import { state } from '../state.js';

export function renderHome() {
  const commits = listCommits(15).catch(() => []);
  const openIssues = listIssues('open').catch(() => []);
  const pinned = getFile('project/dashboard.md').catch(() => null);

  return h('div', {},
    h('div.page-head', {}, h('h1', {}, 'Dashboard')),
    slot(openIssues, taskLine, h('div.meta-line', {}, '…')),
    slot(pinned, pinnedCard, cardShell('📌 Pinned')),
    h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start' },
      slot(commits, activityCard, cardShell('Recent activity')),
      activePagesCard(),
    ),
  );
}

const cardShell = (title) => h('div.card', {}, h('h2', {}, title), skeleton());

function taskLine(issues) {
  const tasks = issues.filter((i) => !i.pull_request);
  const doing = tasks.filter((i) => (i.labels || []).some((l) => l.name === 'doing'));
  return h('div.meta-line', {},
    `${tasks.length} open task${tasks.length === 1 ? '' : 's'}, ${doing.length} in progress — `,
    h('a', { href: '#/tasks' }, 'open the board'));
}

function pinnedCard(pinned) {
  if (!pinned) {
    return h('div.card', {},
      h('h2', {}, '📌 Pinned'),
      h('div.hint', {}, 'Create project/dashboard.md and it will appear here — milestones, deadlines, key links.'));
  }
  const md = h('div.md', { html: render(parseFrontMatter(pinned.text).body) });
  hydrateImages(md, 'project/dashboard.md');
  return h('div.card', {},
    h('div', { style: 'display:flex;align-items:baseline' },
      h('h2', {}, '📌 Pinned'),
      h('div.grow'),
      h('a', { href: '#/e/project/dashboard.md', style: 'font-size:13px' }, 'edit')),
    md);
}

function activityCard(commits) {
  const rows = commits.map((c) => h('div.row', {},
    h('div.grow', {},
      c.commit.message.split('\n')[0],
      h('div.sub', {}, `${c.author?.login || c.commit.author.name} · ${timeago(c.commit.author.date)}`)),
  ));
  return h('div.card.rowlist', {},
    h('h2', {}, 'Recent activity'),
    rows.length ? rows : h('div.hint', {}, 'No commits yet.'));
}

// A row appears the moment a page's front matter comes back saying
// status: active — no waiting for the whole sweep.
function activePagesCard() {
  const list = h('div');
  const tail = h('div', {}, skeleton(2));
  let found = 0;

  (async () => {
    await Promise.all(state.workspaces.map(async (ws) => {
      const entries = await listDir(ws).catch(() => []);
      const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
      await Promise.all(files.map(async (f) => {
        try {
          const { text } = await getFile(f.path);
          if (parseFrontMatter(text).meta.status !== 'active') return;
          found += 1;
          list.append(h('div.row', {},
            h('div.grow', {},
              h('a', { href: `#/p/${f.path.split('/').map(encodeURIComponent).join('/')}` },
                f.path.replace(/\.md$/, ''))),
            chip('active')));
        } catch { /* unreadable page — skip */ }
      }));
    }));
    clear(tail);
    if (!found) tail.append(h('div.hint', {}, 'Pages with front-matter status: active show up here.'));
  })();

  return h('div.card.rowlist', {}, h('h2', {}, 'Active pages'), list, tail);
}
