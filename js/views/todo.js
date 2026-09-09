// The board: one markdown file (Project/Todo.md), one column per person.
// `## Name` headings are the columns and `- [ ]` lines are the items, so the
// file stays a perfectly ordinary checklist when read on GitHub or opened in
// the page editor.
//
// Every edit is a read-modify-write against the live file: we refetch, apply
// the change by matching the item's *text* (never a line number, which the
// other person's edit would have shifted), and PUT with the sha we just read.
// That is what lets two people tick boxes at the same time without either
// one's change disappearing.
import { h, clear, toast } from '../ui.js';
import { getFile, putFile } from '../github.js';
import { renderInline } from '../markdown.js';
import { currentUser } from '../state.js';

const PATH = 'Project/Todo.md';
const POLL_MS = 30000;

// ---------- parsing ----------
// A column is a `## heading` and every task line under it. Anything else in
// the file — front matter, prose, sub-bullets — is untouched by every
// operation below, because they all edit single lines in place.
const HEADING = /^##\s+(.+?)\s*$/;
const TASK = /^(\s*)([-*])\s+\[([ xX])\]\s?(.*)$/;

function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cols = [];
  let cur = null;
  lines.forEach((line, i) => {
    const head = line.match(HEADING);
    if (head) {
      cur = { name: head[1], start: i, items: [] };
      cols.push(cur);
      return;
    }
    if (!cur) return;
    const t = line.match(TASK);
    if (t) cur.items.push({ line: i, done: t[3] !== ' ', text: t[4] });
  });
  return { lines, cols };
}

const findCol = (board, name) => board.cols.find((c) => c.name === name);

// First item in the column whose text matches. Text is the identity here, so
// two identical items in one column are indistinguishable — acceptable, and
// the alternative (ids in the markdown) would spoil the plain-text file.
function findItem(board, colName, text) {
  const col = findCol(board, colName);
  return col ? col.items.find((it) => it.text === text) || null : null;
}

// Where a new item goes: after the last non-blank line of the section, so it
// lands at the bottom of the column whether or not it already has items.
function appendIndex(board, colName) {
  const idx = board.cols.findIndex((c) => c.name === colName);
  if (idx < 0) return -1;
  const nextStart = idx + 1 < board.cols.length ? board.cols[idx + 1].start : board.lines.length;
  let i = nextStart - 1;
  while (i > board.cols[idx].start && board.lines[i].trim() === '') i--;
  return i + 1;
}

// ---------- operations ----------
// Each takes the file's text and returns new text, or null to mean "nothing
// to do" (the item is already gone — someone else got there first).
const opToggle = (colName, text, done) => (src) => {
  const board = parse(src);
  const item = findItem(board, colName, text);
  if (!item || item.done === done) return null;
  board.lines[item.line] = board.lines[item.line].replace(TASK, (_, sp, bullet, __, rest) =>
    `${sp}${bullet} [${done ? 'x' : ' '}] ${rest}`);
  return board.lines.join('\n');
};

const opEdit = (colName, text, next) => (src) => {
  const board = parse(src);
  const item = findItem(board, colName, text);
  if (!item) return null;
  board.lines[item.line] = board.lines[item.line].replace(TASK, (_, sp, bullet, mark) =>
    `${sp}${bullet} [${mark}] ${next}`);
  return board.lines.join('\n');
};

const opDelete = (colName, text) => (src) => {
  const board = parse(src);
  const item = findItem(board, colName, text);
  if (!item) return null;
  board.lines.splice(item.line, 1);
  return board.lines.join('\n');
};

const opAdd = (colName, text) => (src) => {
  const board = parse(src);
  const at = appendIndex(board, colName);
  if (at < 0) return null;
  // An empty column's insertion point is the heading line itself; keep the
  // file's `## Heading` / blank / items shape rather than jamming the first
  // item straight under the heading.
  const afterHeading = board.cols.some((c) => c.start === at - 1);
  board.lines.splice(at, 0, ...(afterHeading ? ['', `- [ ] ${text}`] : [`- [ ] ${text}`]));
  return board.lines.join('\n');
};

// ---------- view ----------
export async function renderTodo() {
  let file;
  try {
    file = await getFile(PATH);
  } catch (err) {
    if (err.status === 404) return missingBoard();
    throw err;
  }

  let text = file.text;
  let sha = file.sha;
  let busy = 0;           // mutations in flight
  let editing = null;     // {col, text} while an item is being edited
  const wrap = h('div');

  // Operations run one at a time. Each refetches first, so a queued click
  // always applies on top of the previous one's result rather than racing it.
  let chain = Promise.resolve();
  function enqueue(op, label) {
    busy += 1;
    chain = chain.then(() => commit(op, label)).catch(() => {});
    const done = chain.finally(() => { busy -= 1; });
    return done;
  }

  async function commit(op, label) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await getFile(PATH);
      const next = op(fresh.text);
      if (next == null) { adopt(fresh.text, fresh.sha); return; }
      try {
        const res = await putFile(PATH, next, label, fresh.sha);
        adopt(next, res.content?.sha || null);
        return;
      } catch (err) {
        // 409/422 mean the sha went stale between our GET and PUT; loop once
        // to reapply on top of whatever landed.
        if (attempt === 0 && (err.status === 409 || err.status === 422)) continue;
        toast(`Couldn't save: ${err.message}`, 'error');
        adopt(fresh.text, fresh.sha);
        return;
      }
    }
  }

  function adopt(nextText, nextSha) {
    text = nextText;
    sha = nextSha;
    draw();
  }

  // Optimistic: change the local text first so the box ticks instantly, then
  // let the server round-trip confirm or correct it.
  function apply(op, label) {
    const local = op(text);
    if (local != null) { text = local; draw(); }
    enqueue(op, label);
  }

  // A redraw replaces every node, and each edit causes two of them — the
  // optimistic one and the one when the save lands a moment later. Carry the
  // cursor and any half-typed text across, or adding several items in a row
  // ejects you from the box mid-word.
  function draw() {
    const active = document.activeElement;
    const focused = active && active.classList && active.classList.contains('todoadd')
      ? active.getAttribute('data-add')
      : null;
    const caret = focused ? [active.selectionStart, active.selectionEnd] : null;
    const drafts = new Map();
    wrap.querySelectorAll('.todoadd').forEach((el) => {
      if (el.value) drafts.set(el.getAttribute('data-add'), el.value);
    });

    const board = parse(text);
    clear(wrap).append(
      h('div.todoboard', {}, board.cols.map((col) => column(col, drafts))),
    );

    if (focused) {
      const box = wrap.querySelector(`[data-add="${cssEscape(focused)}"]`);
      if (box) {
        box.focus();
        if (caret) box.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  function column(col, drafts) {
    const open = col.items.filter((it) => !it.done);
    const done = col.items.filter((it) => it.done);

    const add = h('input.todoadd', {
      type: 'text', placeholder: '+ add', autocomplete: 'off',
      value: drafts.get(col.name) || '',
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        const v = e.target.value.trim();
        if (!v) return;
        e.target.value = '';
        apply(opAdd(col.name, v), `Todo: add to ${col.name}`);
      },
    });
    add.setAttribute('data-add', col.name);

    return h('div.todocol', {},
      h('div.todohead', {},
        h('span.todoname', {}, col.name),
        h('span.todocount', {}, String(open.length)),
      ),
      open.length
        ? open.map((it) => item(col, it))
        : h('div.todoempty', {}, 'nothing open'),
      add,
      done.length ? doneFold(col, done) : null,
    );
  }

  function item(col, it) {
    const box = h('input', {
      type: 'checkbox', class: 'todobox',
      ...(it.done ? { checked: '' } : {}),
      onchange: (e) => apply(
        opToggle(col.name, it.text, e.target.checked),
        `Todo: ${e.target.checked ? 'done' : 'reopen'} — ${it.text.slice(0, 60)}`,
      ),
    });

    const label = h('div.todotext', { html: renderInline(it.text) });
    // Links inside an item stay links; clicking anywhere else starts an edit.
    label.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      startEdit(col, it, label);
    });

    const del = h('button.tododel', {
      title: 'delete', onclick: () => apply(opDelete(col.name, it.text), `Todo: drop — ${it.text.slice(0, 60)}`),
    }, '×');

    return h('div.todoitem', { class: `todoitem${it.done ? ' done' : ''}` }, box, label, del);
  }

  function startEdit(col, it, label) {
    editing = { col: col.name, text: it.text };
    const input = h('input.todoedit', { type: 'text', value: it.text });
    let closed = false;
    const finish = (save) => {
      if (closed) return;
      closed = true;
      editing = null;
      const v = input.value.trim();
      if (save && v && v !== it.text) apply(opEdit(col.name, it.text, v), `Todo: edit — ${v.slice(0, 60)}`);
      else draw();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    label.replaceWith(input);
    input.focus();
    input.select();
  }

  function doneFold(col, done) {
    const key = `logbook:todoopen:${col.name}`;
    const det = h('details.todofold', sessionStorage.getItem(key) === '1' ? { open: '' } : {},
      h('summary', {}, `done (${done.length})`),
      done.map((it) => item(col, it)),
    );
    det.addEventListener('toggle', () => sessionStorage.setItem(key, det.open ? '1' : '0'));
    return det;
  }

  draw();

  // Pick up the other person's edits. Never redraw over an open edit box or
  // an in-flight save — the next tick will get it.
  const timer = setInterval(async () => {
    if (!document.body.contains(wrap)) { clearInterval(timer); return; }
    if (document.hidden || busy || editing) return;
    try {
      const fresh = await getFile(PATH);
      if (fresh.text !== text) adopt(fresh.text, fresh.sha);
    } catch { /* transient — try again next tick */ }
  }, POLL_MS);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, 'Board'),
      h('div.grow'),
      h('a.hint', { href: `#/e/${PATH.split('/').map(encodeURIComponent).join('/')}` }, 'edit as markdown'),
    ),
    wrap,
  );
}

// The board's file is missing — offer to lay down the starting structure
// rather than making someone hand-create it.
function missingBoard() {
  const btn = h('button', { class: 'primary' }, 'Create the board');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const user = await currentUser().catch(() => null);
    // One column for whoever is signed in; the rest get added by editing the
    // file. Deliberately derived rather than a hardcoded team list, since the
    // app is served from a public mirror.
    const seed = `---\nstatus: active\n---\n\n# Todo\n\n`
      + `_Each \`##\` heading is a column; each \`- [ ]\` line is an item._\n\n`
      + `## ${user?.login || 'Todo'}\n`;
    try {
      await putFile(PATH, seed, `New board${user ? ` (by @${user.login})` : ''}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      btn.disabled = false;
      toast(`Couldn't create it: ${err.message}`, 'error');
    }
  });
  return h('div', {},
    h('div.page-head', {}, h('h1', {}, 'Board')),
    h('div.card', {},
      h('div.hint', {}, `No ${PATH} yet — the board is stored there as a plain markdown checklist.`),
      btn),
  );
}

// CSS.escape isn't worth a polyfill for names that are people's first names.
const cssEscape = (s) => s.replace(/["\\]/g, '\\$&');
