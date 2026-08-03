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
  // flat, sorted list of page paths at any depth — minimal + stable so the
  // cache's change detection doesn't fire on metadata churn
  const fetchPaths = async () => {
    const walk = async (dir, depth) => {
      if (depth > 4) return [];
      const entries = await listDirSafe(dir);
      const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md')).map((e) => e.path);
      const dirs = entries.filter((e) => e.type === 'dir' && e.name !== 'assets');
      const nested = await Promise.all(dirs.map((d) => walk(d.path, depth + 1)));
      return files.concat(...nested);
    };
    return (await walk(folder, 0)).sort();
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

  // nested folder tree from relative paths: {pages: [rel], subs: Map<name, node>}
  const buildTree = (rels) => {
    const root = { pages: [], subs: new Map() };
    for (const r of rels) {
      const parts = r.split('/');
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur.subs.has(parts[i])) cur.subs.set(parts[i], { pages: [], subs: new Map() });
        cur = cur.subs.get(parts[i]);
      }
      cur.pages.push(r);
    }
    return root;
  };
  const countPages = (node) =>
    node.pages.length + [...node.subs.values()].reduce((n, s) => n + countPages(s), 0);

  // pages first, then a dropdown per subfolder (recursive) — open state
  // remembered for the session, keyed by the folder's full path
  const renderNode = (node, prefix) => [
    ...node.pages.sort().map((r) => row(`${folder}/${r}`)),
    ...[...node.subs.keys()].sort().map((name) => {
      const sub = node.subs.get(name);
      const full = prefix ? `${prefix}/${name}` : name;
      const key = `logbook:wsopen:${folder}/${full}`;
      const det = h('details.subgroup', sessionStorage.getItem(key) === '1' ? { open: '' } : {},
        h('summary.subhead', {}, `📁 ${name}`, h('span.subcount', {}, `${countPages(sub)}`)),
        ...renderNode(sub, full),
      );
      det.addEventListener('toggle', () => sessionStorage.setItem(key, det.open ? '1' : '0'));
      return det;
    }),
  ];

  const count = h('div.meta-line');
  const listEl = h('div.card.rowlist');
  const formSlot = h('div');
  let subNames = [];
  const draw = (paths) => {
    count.textContent = `${paths.length} page${paths.length === 1 ? '' : 's'}`;
    // every folder prefix at any depth, for the new-page destination picker
    subNames = [...new Set(paths.map(rel).filter((r) => r.includes('/'))
      .map((r) => r.slice(0, r.lastIndexOf('/'))))].sort();
    clear(listEl).append(...(paths.length
      ? renderNode(buildTree(paths.map(rel)), '')
      : [h('div.hint', {}, 'No pages yet — create the first one.')]));
  };

  const paths = await cached(`ws:${folder}`, fetchPaths, (fresh) => {
    if (document.body.contains(listEl)) draw(fresh);
  });
  draw(paths);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, folder === 'Project' ? 'Project (shared)' : folder),
      h('div.grow'),
      h('button', {
        class: 'primary',
        onclick: () => {
          if (formSlot.firstChild) clear(formSlot);
          else formSlot.append(pageForm(folder, subNames, () => clear(formSlot)));
        },
      }, '+ New page'),
    ),
    count,
    formSlot,
    listEl,
  );
}

// Inline creation form: title + destination folder (workspace top level or
// any existing subfolder).
function pageForm(folder, subNames, onClose) {
  const title = h('input', { type: 'text', placeholder: 'Page title', autocomplete: 'off' });
  const dest = h('select', {},
    h('option', { value: '' }, `${folder} (top level)`),
    subNames.map((s) => h('option', { value: s }, `📁 ${s}`)));
  const btn = h('button', { class: 'primary' }, 'Create');

  const submit = async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    btn.disabled = true;
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
    const path = `${folder}/${dest.value ? `${dest.value}/` : ''}${slug}.md`;
    const user = await currentUser().catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const content = `---\nstatus: active\n---\n\n# ${t}\n\n_${today}_\n\n`;
    try {
      await putFile(path, content, `New page: ${t}${user ? ` (by @${user.login})` : ''}`);
      invalidate(`ws:${folder}`);
      onClose();
      location.hash = `#/e/${path.split('/').map(encodeURIComponent).join('/')}`;
    } catch (err) {
      btn.disabled = false;
      toast(err.status === 422 ? 'A page with that name already exists there.' : `Couldn't create page: ${err.message}`, 'error');
    }
  };
  btn.addEventListener('click', submit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const form = h('div.card.page-form', {},
    title, dest, btn,
    h('button', { onclick: onClose }, 'Cancel'),
  );
  setTimeout(() => title.focus(), 0);
  return form;
}

async function listDirSafe(path) {
  try { return await listDir(path); } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

