// A member's workspace: their markdown pages (one folder, optional subfolders).
import { h, chip, toast } from '../ui.js';
import { listDir, getFile, putFile } from '../github.js';
import { parseFrontMatter } from '../markdown.js';
import { currentUser } from '../state.js';

export async function renderWorkspace(folder) {
  const entries = await listDirSafe(folder);
  const pages = [];
  const dirs = [];
  for (const e of entries) {
    if (e.type === 'dir') dirs.push(e);
    else if (e.name.endsWith('.md')) pages.push(e);
  }
  // one level of subfolders
  for (const d of dirs) {
    if (d.name === 'assets') continue;
    for (const e of await listDirSafe(`${folder}/${d.name}`)) {
      if (e.type === 'file' && e.name.endsWith('.md')) pages.push(e);
    }
  }

  // Pull status chips from front matter (a few small requests; fine at this scale).
  const withMeta = await Promise.all(pages.map(async (p) => {
    try {
      const { text } = await getFile(p.path);
      const { meta } = parseFrontMatter(text);
      return { ...p, status: meta.status };
    } catch {
      return { ...p, status: undefined };
    }
  }));

  const rows = withMeta
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((p) => h('div.row', {},
      h('div.grow', {},
        h('a', { href: `#/p/${p.path.split('/').map(encodeURIComponent).join('/')}` },
          p.path.replace(`${folder}/`, '').replace(/\.md$/, '')),
      ),
      chip(p.status),
    ));

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, folder === 'project' ? 'Project (shared)' : folder),
      h('div.grow'),
      h('button', { class: 'primary', onclick: () => newPage(folder) }, '+ New page'),
    ),
    h('div.meta-line', {}, `${withMeta.length} page${withMeta.length === 1 ? '' : 's'}`),
    h('div.card.rowlist', {}, rows.length ? rows : h('div.hint', {}, 'No pages yet — create the first one.')),
  );
}

async function listDirSafe(path) {
  try { return await listDir(path); } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export async function newPage(folder) {
  const title = prompt('Page title:');
  if (!title) return;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  const path = `${folder}/${slug}.md`;
  const user = await currentUser().catch(() => null);
  const today = new Date().toISOString().slice(0, 10);
  const content = `---\nstatus: active\n---\n\n# ${title}\n\n_${today}_\n\n`;
  try {
    await putFile(path, content, `New page: ${title}${user ? ` (by @${user.login})` : ''}`);
    location.hash = `#/e/${path.split('/').map(encodeURIComponent).join('/')}`;
  } catch (err) {
    toast(err.status === 422 ? 'A page with that name already exists.' : `Couldn't create page: ${err.message}`, 'error');
  }
}
