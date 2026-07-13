// A member's workspace: their markdown pages (one folder, optional subfolders).
// The page list is session-cached (instant on revisit, revalidated in the
// background); status chips read through the same cache as the page view, so
// chips are instant for anything already seen — and browsing a list warms
// every page on it.
import { h, clear, chip, toast } from '../ui.js';
import { listDir, getFile, putFile } from '../github.js';
import { parseFrontMatter } from '../markdown.js';
import { currentUser } from '../state.js';
import { cached, invalidate } from '../cache.js';

export async function renderWorkspace(folder) {
  // flat, sorted list of page paths — minimal + stable so the cache's
  // change detection doesn't fire on metadata churn
  const fetchPaths = async () => {
    const entries = await listDirSafe(folder);
    const paths = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md')).map((e) => e.path);
    const dirs = entries.filter((e) => e.type === 'dir' && e.name !== 'assets');
    const subs = await Promise.all(dirs.map((d) => listDirSafe(`${folder}/${d.name}`)));
    for (const sub of subs) {
      paths.push(...sub.filter((e) => e.type === 'file' && e.name.endsWith('.md')).map((e) => e.path));
    }
    return paths.sort();
  };

  const rel = (p) => p.replace(`${folder}/`, '');
  const row = (path) => {
    const chipWrap = h('span', {}, h('span.skeleton-chip'));
    const setChip = ({ text }) => {
      const c = chip(parseFrontMatter(text).meta.status);
      clear(chipWrap);
      if (c) chipWrap.append(c);
    };
    cached(`page:${path}`, () => getFile(path), setChip)
      .then(setChip)
      .catch(() => clear(chipWrap));
    return h('div.row', {},
      h('div.grow', {},
        h('a', { href: `#/p/${path.split('/').map(encodeURIComponent).join('/')}` },
          rel(path).split('/').pop().replace(/\.md$/, '')),
      ),
      chipWrap,
    );
  };

  const count = h('div.meta-line');
  const listEl = h('div.card.rowlist');
  const draw = (paths) => {
    count.textContent = `${paths.length} page${paths.length === 1 ? '' : 's'}`;
    const subNames = [...new Set(paths.filter((p) => rel(p).includes('/')).map((p) => rel(p).split('/')[0]))].sort();
    clear(listEl).append(...(paths.length ? [
      ...paths.filter((p) => !rel(p).includes('/')).map(row),
      ...subNames.flatMap((sub) => [
        h('div.subhead', {}, `📁 ${sub}`),
        ...paths.filter((p) => rel(p).startsWith(`${sub}/`)).map(row),
      ]),
    ] : [h('div.hint', {}, 'No pages yet — create the first one.')]));
  };

  const paths = await cached(`ws:${folder}`, fetchPaths, (fresh) => {
    if (document.body.contains(listEl)) draw(fresh);
  });
  draw(paths);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, folder === 'Project' ? 'Project (shared)' : folder),
      h('div.grow'),
      h('button', { class: 'primary', onclick: () => newPage(folder) }, '+ New page'),
    ),
    count,
    listEl,
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
    invalidate(`ws:${folder}`);
    location.hash = `#/e/${path.split('/').map(encodeURIComponent).join('/')}`;
  } catch (err) {
    toast(err.status === 422 ? 'A page with that name already exists.' : `Couldn't create page: ${err.message}`, 'error');
  }
}
