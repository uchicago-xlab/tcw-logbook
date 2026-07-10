// A member's workspace: their markdown pages (one folder, optional subfolders).
// Rows render as soon as the directory listing is in; the status chips need a
// getFile per page for front matter, so they stream in afterwards.
import { h, chip, toast } from '../ui.js';
import { listDir, getFile, putFile } from '../github.js';
import { parseFrontMatter } from '../markdown.js';
import { currentUser } from '../state.js';

export async function renderWorkspace(folder) {
  const entries = await listDirSafe(folder);
  const pages = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  // one level of subfolders, listed in parallel
  const dirs = entries.filter((e) => e.type === 'dir' && e.name !== 'assets');
  const subs = await Promise.all(dirs.map((d) => listDirSafe(`${folder}/${d.name}`)));
  for (const sub of subs) {
    pages.push(...sub.filter((e) => e.type === 'file' && e.name.endsWith('.md')));
  }

  const rows = pages
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((p) => {
      const chipSlot = h('span.skeleton-chip');
      getFile(p.path)
        .then(({ text }) => {
          const c = chip(parseFrontMatter(text).meta.status);
          if (c) chipSlot.replaceWith(c); else chipSlot.remove();
        })
        .catch(() => chipSlot.remove());
      return h('div.row', {},
        h('div.grow', {},
          h('a', { href: `#/p/${p.path.split('/').map(encodeURIComponent).join('/')}` },
            p.path.replace(`${folder}/`, '').replace(/\.md$/, '')),
        ),
        chipSlot,
      );
    });

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, folder === 'Project' ? 'Project (shared)' : folder),
      h('div.grow'),
      h('button', { class: 'primary', onclick: () => newPage(folder) }, '+ New page'),
    ),
    h('div.meta-line', {}, `${pages.length} page${pages.length === 1 ? '' : 's'}`),
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
