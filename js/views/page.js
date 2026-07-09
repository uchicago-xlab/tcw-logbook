// Page view + editor. Every save is a commit; conflicts are detected via the
// file's sha (if someone else saved since you opened it, GitHub returns 409).
import { h, clear, chip, toast, timeago } from '../ui.js';
import { getFile, putFile, deleteFile, getFileAsObjectURL } from '../github.js';
import { render, parseFrontMatter } from '../markdown.js';
import { currentUser, state, refreshWorkspaces } from '../state.js';
import { cached, invalidate } from '../cache.js';

const STATUSES = ['active', 'paused', 'done'];

export async function renderPage(path, editing) {
  // The editor always fetches fresh: its sha drives conflict detection.
  if (editing) return editor(path, await getFile(path));
  const myHash = location.hash;
  const file = await cached(`page:${path}`, () => getFile(path), () => {
    // changed upstream — re-render (from the now-fresh cache) if still open
    if (location.hash === myHash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  return viewer(path, file);
}

// ---------- viewer ----------
function viewer(path, file) {
  const { meta, body } = parseFrontMatter(file.text);
  const folder = path.split('/')[0];
  const isMap = (meta.view || '').toLowerCase() === 'map';
  let asMap = isMap;

  const content = h('div');
  const drawBody = () => {
    if (asMap) {
      clear(content).append(mapView(body, path));
    } else {
      const md = h('div.md', { html: render(body) });
      hydrateImages(md, path);
      clear(content).append(h('div.card', {}, md));
    }
    if (modeBtn) modeBtn.textContent = asMap ? 'Document view' : 'Map view';
  };
  const modeBtn = isMap
    ? h('button', { onclick: () => { asMap = !asMap; drawBody(); } })
    : null;
  drawBody();

  // moving is create-at-destination + delete-original; the pinned dashboard
  // is found by exact path, so it stays put
  const moveSlot = h('div');
  const moveBtn = path === 'project/dashboard.md' ? null : h('button', {
    onclick: async () => {
      if (moveSlot.firstChild) { clear(moveSlot); return; }
      if (!state.workspacesLoaded) await refreshWorkspaces();
      moveSlot.append(moveForm(path, file, () => clear(moveSlot)));
    },
  }, 'Move');

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, titleOf(path)),
      chip(meta.status),
      h('div.grow'),
      moveBtn,
      modeBtn,
      h('button', { class: 'primary', onclick: () => { location.hash = `#/e/${enc(path)}`; } }, 'Edit'),
    ),
    h('div.meta-line', {},
      h('a', { href: `#/w/${encodeURIComponent(folder)}` }, folder), ` / ${path.split('/').slice(1).join('/')}`),
    moveSlot,
    content,
  );
}

// ---------- move ----------
function moveForm(path, file, onClose) {
  const from = path.split('/')[0];
  const name = path.split('/').pop();
  const sel = h('select', {}, state.workspaces.filter((w) => w !== from)
    .map((f) => h('option', { value: f }, f)));
  const btn = h('button', { class: 'primary' }, 'Move');

  btn.addEventListener('click', async () => {
    const dest = sel.value;
    const target = `${dest}/${name}`;
    btn.disabled = true;
    const user = await currentUser().catch(() => null);
    const msg = `Move ${titleOf(path)} to ${dest}${user ? ` (by @${user.login})` : ''}`;
    try {
      await putFile(target, file.text, msg);
    } catch (err) {
      btn.disabled = false;
      toast(err.status === 422
        ? `"${name}" already exists in ${dest} — rename one of them first.`
        : `Move failed: ${err.message}`, 'error');
      return;
    }
    try {
      await deleteFile(path, msg, file.sha);
      toast('Moved ✓');
    } catch (err) {
      toast(`Copied to ${dest}, but couldn't remove the original: ${err.message}`, 'error');
    }
    invalidate(`page:${path}`);
    invalidate(`page:${target}`);
    onClose();
    state.workspacesLoaded = false; // sidebar counts may shift
    location.hash = `#/p/${enc(target)}`;
  });

  return h('div.card.move-form', {},
    h('span', { style: 'font-size:13.5px;color:var(--muted)' }, `Move “${name}” to:`),
    sel, btn,
    h('button', { onclick: onClose }, 'Cancel'),
  );
}

// ---------- map view ----------
// A page with `view: map` front matter renders as side-by-side columns of
// cards (Miro-style): each `## heading` starts a column, `---` lines split
// cards within it. The same markdown reads fine as a linear document.
function mapView(body, path) {
  const clusters = [];
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur && buf.join('\n').trim()) cur.cards.push(buf.join('\n'));
    buf = [];
  };
  for (const line of body.split('\n')) {
    const head = line.match(/^##\s+(.*)$/);
    if (head) { flush(); cur = { title: head[1], cards: [] }; clusters.push(cur); }
    else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); }
    else if (cur || line.trim()) {
      if (!cur) { cur = { title: '', cards: [] }; clusters.push(cur); }
      buf.push(line);
    }
  }
  flush();

  const row = h('div.maprow', {}, clusters.filter((c) => c.title || c.cards.length).map((c) =>
    h('div.mapcol', {},
      c.title ? h('div.mapcol-title', {}, c.title) : null,
      c.cards.map((cardMd) => {
        const inner = h('div.md', { html: render(cardMd) });
        hydrateImages(inner, path);
        return h('div.card.mapcard', {}, inner);
      }),
    )));

  let zoom = 1;
  const pct = h('span.mapzoom-pct', {}, '100%');
  const setZoom = (z) => {
    zoom = Math.min(1.5, Math.max(0.5, Math.round(z * 10) / 10));
    row.style.zoom = zoom;
    pct.textContent = `${Math.round(zoom * 100)}%`;
  };
  return h('div', {},
    h('div.mapzoom', {},
      h('button', { onclick: () => setZoom(zoom - 0.1) }, '−'),
      pct,
      h('button', { onclick: () => setZoom(zoom + 0.1) }, '+'),
      h('span.hint', { style: 'margin:0 0 0 10px' }, `${clusters.length} columns · scroll sideways`),
    ),
    h('div.mapwrap', {}, row),
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
    // keep any other front-matter keys (e.g. view: map), only status changes
    const kv = { ...meta, status: statusSel.value };
    const front = `---\n${Object.entries(kv).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n`;
    const user = await currentUser().catch(() => null);
    try {
      const res = await putFile(path, front + ta.value.replace(/^\n+/, ''),
        `Edit ${titleOf(path)}${user ? ` (by @${user.login})` : ''}`, sha);
      sha = res.content.sha;
      dirty = false;
      invalidate(`page:${path}`); // viewer cache is now stale
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
