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

  const draw = () => {
    clear(container).append(viewMode === 'board' ? board(tasks, redraw) : list(tasks, redraw));
  };
  async function redraw() {
    // re-render whole route for fresh data
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  const toggle = h('button', {
    onclick: () => { viewMode = viewMode === 'board' ? 'list' : 'board'; draw(); },
  }, viewMode === 'board' ? 'List view' : 'Board view');

  draw();

  return h('div', {},
    h('div.page-head', {},
      h('h1', {}, 'Tasks'),
      h('div.grow'),
      toggle,
      h('button', { class: 'primary', onclick: () => quickCreate(collaborators) }, '+ New task'),
    ),
    h('div.meta-line', {},
      `${tasks.filter((t) => t.status !== 'done').length} open · also visible as `,
      h('a', { href: issuesUrl(), target: '_blank', rel: 'noopener' }, 'GitHub Issues'), '.'),
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

async function quickCreate(collaborators) {
  const title = prompt('Task title:');
  if (!title) return;
  let assignee = '';
  if (collaborators.length) {
    const names = collaborators.map((c) => c.login).join(', ');
    assignee = prompt(`Assign to (blank for nobody): ${names}`, '') || '';
  }
  const due = prompt('Due date YYYY-MM-DD (blank for none):', '') || '';
  try {
    await createIssue(title, {
      assignees: assignee ? [assignee.trim()] : [],
      body: due ? `due: ${due.trim()}` : '',
    });
    toast('Task created ✓');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (err) {
    toast(`Couldn't create task: ${err.message}`, 'error');
  }
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
