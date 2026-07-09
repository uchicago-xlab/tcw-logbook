// Tasks = GitHub Issues. One entity, two views (list & board).
// status: open issue → todo; open + "doing" label → doing; closed → done.
// Moves are optimistic: the card jumps immediately, the API call follows,
// and a failure snaps it back with an error toast.
import { h, clear, chip, toast, timeago } from '../ui.js';
import { listIssues, createIssue, updateIssue, getCollaborators } from '../github.js';
import { loadConfig } from '../config.js';
import { cached, revalidate, invalidate } from '../cache.js';

let viewMode = 'board'; // remembered per session

const fetchAll = async () => {
  const [open, closed, collaborators] = await Promise.all([
    listIssues('open'),
    listIssues('closed'),
    getCollaborators().catch(() => []),
  ]);
  return { open, closed, collaborators };
};

export async function renderTasks() {
  const container = h('div');
  const formSlot = h('div');
  const count = h('span');
  let tasks = [];
  let pending = 0; // optimistic moves still awaiting the API

  // Redraw from a background refetch — but never over an open form or an
  // in-flight move; the fresh data is already cached for the next render.
  function applyFresh(data) {
    if (!document.body.contains(container) || formSlot.firstChild || pending) return;
    tasks = toTasks(data);
    draw();
  }

  const data = await cached('tasks', fetchAll, applyFresh);
  tasks = toTasks(data);

  function draw() {
    toggle.textContent = viewMode === 'board' ? 'List view' : 'Board view';
    count.textContent = `${tasks.filter((t) => t.status !== 'done').length} open`;
    clear(container).append(
      !tasks.length
        ? h('div.card', {}, h('div.hint', { style: 'margin:0' }, 'No tasks yet — create the first one with “+ New task”.'))
        : viewMode === 'board' ? board(tasks, move) : list(tasks, move),
    );
  }

  // Optimistic: move the card now, tell GitHub after, revert on failure.
  async function move(task, status) {
    const prev = task.status;
    task.status = status;
    pending += 1;
    draw();
    try {
      if (status === 'done') await updateIssue(task.number, { state: 'closed' });
      else if (status === 'doing') await updateIssue(task.number, { state: 'open', labels: ['doing'] });
      else await updateIssue(task.number, { state: 'open', labels: [] });
      // bring the cache up to server truth in the background
      revalidate('tasks', fetchAll).then((fresh) => fresh && applyFresh(fresh)).catch(() => {});
    } catch (err) {
      task.status = prev;
      draw();
      toast(`Couldn't update: ${err.message}`, 'error');
    } finally {
      pending -= 1;
    }
  }

  const toggle = h('button', {
    onclick: () => { viewMode = viewMode === 'board' ? 'list' : 'board'; draw(); },
  });

  draw();

  // keep an open board fresh: quietly revalidate every 30s while visible;
  // applyFresh decides whether it's safe to redraw
  const refreshTimer = setInterval(() => {
    if (!document.body.contains(container)) { clearInterval(refreshTimer); return; }
    if (document.hidden) return;
    revalidate('tasks', fetchAll).then((fresh) => fresh && applyFresh(fresh)).catch(() => {});
  }, 30000);

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, 'Tasks'),
      h('div.grow'),
      toggle,
      h('button', {
        class: 'primary',
        onclick: () => {
          if (formSlot.firstChild) clear(formSlot);
          else formSlot.append(taskForm(data.collaborators, () => clear(formSlot)));
        },
      }, '+ New task'),
    ),
    h('div.meta-line', {},
      count, ' · also visible as ',
      h('a', { href: issuesUrl(), target: '_blank', rel: 'noopener' }, 'GitHub Issues'), '.'),
    formSlot,
    container,
  );
}

function toTasks({ open, closed }) {
  return [
    ...open.filter((i) => !i.pull_request).map((i) => toTask(i, hasLabel(i, 'doing') ? 'doing' : 'todo')),
    ...closed.filter((i) => !i.pull_request).slice(0, 20).map((i) => toTask(i, 'done')),
  ];
}

function toTask(issue, status) {
  const due = (issue.body || '').match(/^due:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
  return {
    number: issue.number,
    title: issue.title,
    assignees: (issue.assignees || []).map((a) => a.login),
    status,
    due,
    updated: issue.updated_at,
    url: issue.html_url,
  };
}

const hasLabel = (issue, name) => (issue.labels || []).some((l) => l.name === name);
const issuesUrl = () => `https://github.com/${loadConfig().repo}/issues`;

function taskForm(collaborators, onClose) {
  const title = h('input', { type: 'text', placeholder: 'Task title', autocomplete: 'off' });
  const assignee = h('select', {},
    h('option', { value: '' }, 'unassigned'),
    collaborators.map((c) => h('option', { value: c.login }, `@${c.login}`)));
  const due = h('input', { type: 'date', title: 'due date (optional)' });
  const create = h('button', { class: 'primary' }, 'Create');

  const submit = async () => {
    if (!title.value.trim()) { title.focus(); return; }
    create.disabled = true;
    try {
      await createIssue(title.value.trim(), {
        assignees: assignee.value ? [assignee.value] : [],
        body: due.value ? `due: ${due.value}` : '',
      });
      invalidate('tasks'); // force a fresh list on the re-render
      toast('Task created ✓');
      onClose();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      create.disabled = false;
      toast(`Couldn't create task: ${err.message}`, 'error');
    }
  };
  create.addEventListener('click', submit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const form = h('div.card.task-form', {},
    title,
    collaborators.length ? assignee : null,
    due,
    create,
    h('button', { onclick: onClose }, 'Cancel'),
  );
  setTimeout(() => title.focus(), 0);
  return form;
}

// ---------- board ----------
function board(tasks, move) {
  const cols = ['todo', 'doing', 'done'].map((status) => {
    const cards = tasks.filter((t) => t.status === status).map((t) => card(t, move));
    return h('div.col', {},
      h('h3', {}, `${status} (${cards.length})`),
      cards.length ? cards : h('div.hint', { style: 'padding:4px 6px' }, '—'),
    );
  });
  return h('div.board', {}, cols);
}

function card(t, move) {
  const moves = {
    todo: [['start →', 'doing']],
    doing: [['← todo', 'todo'], ['done ✓', 'done']],
    done: [['↩ reopen', 'todo']],
  }[t.status];
  return h('div.taskcard', {},
    h('div', {}, h('a', { href: t.url, target: '_blank', rel: 'noopener', style: 'color:inherit' }, t.title)),
    h('div.sub', {},
      t.assignees.length ? `@${t.assignees.join(', @')}` : 'unassigned',
      t.due ? h('span', { style: overdue(t) ? 'color:#b91c1c;font-weight:600' : '' }, `due ${t.due}`) : null,
    ),
    h('div.movers', {}, moves.map(([label, to]) =>
      h('button', { onclick: () => move(t, to) }, label))),
  );
}

// ---------- list ----------
function list(tasks, move) {
  const groups = ['doing', 'todo', 'done'];
  return h('div.card.rowlist', {}, groups.flatMap((status) => {
    const rows = tasks.filter((t) => t.status === status).map((t) =>
      h('div.row', {},
        h('input', {
          type: 'checkbox', ...(status === 'done' ? { checked: true } : {}),
          onchange: () => move(t, status === 'done' ? 'todo' : 'done'),
        }),
        h('div.grow', {},
          h('a', { href: t.url, target: '_blank', rel: 'noopener', style: 'color:inherit' }, t.title),
          h('div.sub', {},
            t.assignees.length ? `@${t.assignees.join(', @')} · ` : '',
            t.due ? `due ${t.due} · ` : '',
            `updated ${timeago(t.updated)}`),
        ),
        chip(t.status),
      ));
    return rows.length ? [h('div.section', { style: 'margin:10px 0 2px' }, status), ...rows] : [];
  }));
}

function overdue(t) {
  return t.due && t.status !== 'done' && t.due < new Date().toISOString().slice(0, 10);
}
