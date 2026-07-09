// Tasks = GitHub Issues. One entity, two views (list & board).
// status: open issue → todo; open + "doing" label → doing; closed → done.
import { h, clear, chip, toast, timeago } from '../ui.js';
import { listIssues, createIssue, updateIssue, getCollaborators } from '../github.js';
import { loadConfig } from '../config.js';

let viewMode = 'board'; // remembered per session

export async function renderTasks() {
  const [open, closed, collaborators] = await Promise.all([
    listIssues('open'),
    listIssues('closed'),
    getCollaborators().catch(() => []),
  ]);

  const tasks = [
    ...open.filter((i) => !i.pull_request).map((i) => toTask(i, hasLabel(i, 'doing') ? 'doing' : 'todo')),
    ...closed.filter((i) => !i.pull_request).slice(0, 20).map((i) => toTask(i, 'done')),
  ];

  const container = h('div');
  const formSlot = h('div');

  const draw = () => {
    toggle.textContent = viewMode === 'board' ? 'List view' : 'Board view';
    clear(container).append(
      !tasks.length
        ? h('div.card', {}, h('div.hint', { style: 'margin:0' }, 'No tasks yet — create the first one with “+ New task”.'))
        : viewMode === 'board' ? board(tasks, redraw) : list(tasks, redraw),
    );
  };
  async function redraw() {
    // re-render whole route for fresh data
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  const toggle = h('button', {
    onclick: () => { viewMode = viewMode === 'board' ? 'list' : 'board'; draw(); },
  });

  draw();

  // keep an open board fresh: re-render the route every 30s while it's
  // visible, unless the create form is open (that would wipe typed input)
  const refreshTimer = setInterval(() => {
    if (!document.body.contains(container)) { clearInterval(refreshTimer); return; }
    if (formSlot.firstChild || document.hidden) return;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
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
          else formSlot.append(taskForm(collaborators, () => clear(formSlot)));
        },
      }, '+ New task'),
    ),
    h('div.meta-line', {},
      `${tasks.filter((t) => t.status !== 'done').length} open · also visible as `,
      h('a', { href: issuesUrl(), target: '_blank', rel: 'noopener' }, 'GitHub Issues'), '.'),
    formSlot,
    container,
  );
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

// ---------- mutations ----------
async function setStatus(task, status, redraw) {
  try {
    if (status === 'done') await updateIssue(task.number, { state: 'closed' });
    else if (status === 'doing') await updateIssue(task.number, { state: 'open', labels: ['doing'] });
    else await updateIssue(task.number, { state: 'open', labels: [] });
    toast(`→ ${status}`);
    redraw();
  } catch (err) {
    toast(`Couldn't update: ${err.message}`, 'error');
  }
}

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
function board(tasks, redraw) {
  const cols = ['todo', 'doing', 'done'].map((status) => {
    const cards = tasks.filter((t) => t.status === status).map((t) => card(t, redraw));
    return h('div.col', {},
      h('h3', {}, `${status} (${cards.length})`),
      cards.length ? cards : h('div.hint', { style: 'padding:4px 6px' }, '—'),
    );
  });
  return h('div.board', {}, cols);
}

function card(t, redraw) {
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
      h('button', { onclick: () => setStatus(t, to, redraw) }, label))),
  );
}

// ---------- list ----------
function list(tasks, redraw) {
  const groups = ['doing', 'todo', 'done'];
  return h('div.card.rowlist', {}, groups.flatMap((status) => {
    const rows = tasks.filter((t) => t.status === status).map((t) =>
      h('div.row', {},
        h('input', {
          type: 'checkbox', ...(status === 'done' ? { checked: true } : {}),
          onchange: () => setStatus(t, status === 'done' ? 'todo' : 'done', redraw),
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
