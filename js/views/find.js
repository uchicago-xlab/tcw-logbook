// Wiki-link resolution: find a page whose filename matches the linked title.
import { h } from '../ui.js';
import { listDir } from '../github.js';
import { state } from '../state.js';

// Normalize link text and filenames the same way, so [[ImplementationDetails]],
// [[implementation details]] and "Implementation Details.md" all meet at
// "implementation-details".
const slugify = (s) =>
  s.replace(/\.md$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function renderFind(title) {
  const slug = slugify(title);
  const matches = [];
  for (const ws of state.workspaces) {
    const entries = await listDir(ws).catch(() => []);
    for (const e of entries) {
      if (e.type === 'file' && slugify(e.name) === slug) matches.push(e.path);
      if (e.type === 'dir' && e.name !== 'assets') {
        for (const s of await listDir(e.path).catch(() => [])) {
          if (s.type === 'file' && slugify(s.name) === slug) matches.push(s.path);
        }
      }
    }
  }

  if (matches.length === 1) {
    location.replace(`#/p/${matches[0].split('/').map(encodeURIComponent).join('/')}`);
    return h('div', {}, 'Opening…');
  }

  return h('div', {},
    h('div.page-head', {}, h('h1', {}, `“${title}”`)),
    h('div.card', {},
      matches.length === 0
        ? h('div', {}, `No page named “${slug}.md” exists yet. Create it in a workspace from the sidebar.`)
        : h('div.rowlist', {}, matches.map((m) => h('div.row', {},
            h('a', { href: `#/p/${m.split('/').map(encodeURIComponent).join('/')}` }, m)))),
    ),
  );
}
