// Page view + editor. Every save is a commit; conflicts are detected via the
// file's sha (if someone else saved since you opened it, GitHub returns 409).
import { h, chip, toast, timeago } from '../ui.js';
import { getFile, putFile, getFileAsObjectURL } from '../github.js';
import { render, parseFrontMatter } from '../markdown.js';
import { currentUser } from '../state.js';

const STATUSES = ['active', 'paused', 'done'];

export async function renderPage(path, editing) {
  const file = await getFile(path);
  return editing ? editor(path, file) : viewer(path, file);
}

// ---------- viewer ----------
function viewer(path, file) {
  const { meta, body } = parseFrontMatter(file.text);
  const folder = path.split('/')[0];
  const md = h('div.md', { html: render(body) });
  hydrateImages(md, path);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, titleOf(path)),
      chip(meta.status),
      h('div.grow'),
      h('button', { class: 'primary', onclick: () => { location.hash = `#/e/${enc(path)}`; } }, 'Edit'),
    ),
    h('div.meta-line', {},
      h('a', { href: `#/w/${encodeURIComponent(folder)}` }, folder), ` / ${path.split('/').slice(1).join('/')}`),
    h('div.card', {}, md),
  );
}

// ---------- editor ----------
function editor(path, file) {
  let { meta, body } = parseFrontMatter(file.text);
  let sha = file.sha;
  let dirty = false;

  const ta = h('textarea', { spellcheck: 'false' });
  ta.value = body;
  const preview = h('div.editor-preview.md', { html: render(body) });
  const saveBtn = h('button', { class: 'primary' }, 'Save');
  const statusSel = h('select', { style: 'width:auto' },
    STATUSES.map((s) => {
      const o = h('option', { value: s }, s);
      if ((meta.status || 'active') === s) o.selected = true;
      return o;
    }),
  );

  let previewTimer;
  ta.addEventListener('input', () => {
    dirty = true;
    saveBtn.textContent = 'Save*';
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      preview.innerHTML = render(ta.value);
      hydrateImages(preview, path);
    }, 250);
  });

  // Tab inserts two spaces instead of leaving the field.
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      ta.setRangeText('  ', s, en, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  });

  async function save() {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const front = `---\nstatus: ${statusSel.value}\n---\n\n`;
    const user = await currentUser().catch(() => null);
    try {
      const res = await putFile(path, front + ta.value.replace(/^\n+/, ''),
        `Edit ${titleOf(path)}${user ? ` (by @${user.login})` : ''}`, sha);
      sha = res.content.sha;
      dirty = false;
      saveBtn.textContent = 'Save';
      toast('Saved ✓');
    } catch (err) {
      saveBtn.textContent = 'Save*';
      if (err.status === 409 || err.status === 422) {
        toast('Conflict: someone saved this page after you opened it. Open the page in a new tab to compare before overwriting.', 'error');
      } else {
        toast(`Save failed: ${err.message}`, 'error');
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(ta)) { document.removeEventListener('keydown', onKey); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  window.onbeforeunload = () => (dirty ? true : undefined);
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });

  hydrateImages(preview, path);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, titleOf(path)),
      h('div.grow'),
      h('span', { style: 'font-size:13px;color:var(--muted)' }, 'status:'),
      statusSel,
      saveBtn,
      h('button', {
        onclick: () => {
          if (dirty && !confirm('Discard unsaved changes?')) return;
          window.onbeforeunload = null;
          location.hash = `#/p/${enc(path)}`;
        },
      }, 'Done'),
    ),
    h('div.meta-line', {}, 'Markdown, with $math$, ``` code, tables, and [[wiki-links]]. ',
      h('span.kbd', {}, '⌘S'), ' saves (as a commit).'),
    h('div.editor-wrap', {}, ta, preview),
  );
}

// ---------- shared ----------
// Relative image paths can't be plain <img src> (private repo needs auth),
// so we fetch them through the API and swap in object URLs.
export function hydrateImages(container, pagePath) {
  const dir = pagePath.split('/').slice(0, -1).join('/');
  container.querySelectorAll('img[data-src]').forEach(async (img) => {
    const src = img.getAttribute('data-src');
    if (/^https?:\/\//.test(src)) { img.src = src; return; }
    const full = src.startsWith('/') ? src.slice(1) : `${dir}/${src}`.replace(/\/\.\//g, '/');
    try { img.src = await getFileAsObjectURL(full); }
    catch { img.alt = `⚠ image not found: ${src}`; }
  });
}

function titleOf(path) {
  return path.split('/').pop().replace(/\.md$/, '').replace(/-/g, ' ');
}

function enc(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}
