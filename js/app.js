// Logbook — entry point, hash router, and layout shell.
import { isConfigured, loadConfig } from './config.js';
import { h, clear } from './ui.js';
import { renderSetup } from './views/setup.js';
import { renderHome } from './views/home.js';
import { renderWorkspace } from './views/workspace.js';
import { renderPage } from './views/page.js';
import { renderTasks } from './views/tasks.js';
import { renderFind } from './views/find.js';
import { state, refreshWorkspaces } from './state.js';

const app = document.getElementById('app');

function layout(main) {
  clear(app);
  app.append(sidebar(), h('div', { id: 'main' }, main));
}

function sidebar() {
  const cfg = loadConfig();
  const route = location.hash || '#/';
  const link = (href, label) =>
    h('a.navlink', { href, class: `navlink${route === href ? ' active' : ''}` }, label);

  const wsLinks = state.workspaces.map((w) =>
    h('a.navlink', {
      href: `#/w/${encodeURIComponent(w)}`,
      class: `navlink${route.startsWith(`#/w/${encodeURIComponent(w)}`) ? ' active' : ''}`,
    }, w === 'project' ? '🗂 project (shared)' : w),
  );

  return h('nav', { id: 'sidebar' },
    h('div.brand', {}, h('a', { href: '#/' }, 'Logbook')),
    link('#/', 'Dashboard'),
    link('#/tasks', 'Tasks'),
    h('div.section', {}, 'Workspaces'),
    wsLinks.length ? wsLinks : h('div.hint', { style: 'padding:0 10px' }, 'none yet'),
    h('div.foot', {},
      cfg.repo ? h('div', {}, `repo: ${cfg.repo}`) : null,
      h('a', { href: '#/settings' }, 'Settings'),
    ),
  );
}

async function route() {
  if (!isConfigured() && location.hash !== '#/settings') {
    clear(app).append(renderSetup(() => { location.hash = '#/'; route(); }));
    return;
  }

  const hash = location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = hash.split('/');

  // Load workspace list once per session (sidebar needs it everywhere).
  if (isConfigured() && !state.workspacesLoaded) {
    try { await refreshWorkspaces(); } catch { /* surfaced by views */ }
  }

  let view;
  if (head === '' || head === undefined) view = await safe(renderHome);
  else if (head === 'tasks') view = await safe(renderTasks);
  else if (head === 'w') view = await safe(() => renderWorkspace(decodeURIComponent(rest.join('/'))));
  else if (head === 'p') view = await safe(() => renderPage(rest.map(decodeURIComponent).join('/'), false));
  else if (head === 'e') view = await safe(() => renderPage(rest.map(decodeURIComponent).join('/'), true));
  else if (head === 'find') view = await safe(() => renderFind(decodeURIComponent(rest.join('/'))));
  else if (head === 'settings') view = renderSetup(() => { location.hash = '#/'; });
  else view = h('div', {}, 'Not found. ', h('a', { href: '#/' }, 'Go home'));

  layout(view);
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return h('div.card', {},
      h('h2', {}, 'Something went wrong'),
      h('div', {}, String(err.message || err)),
      h('div.hint', {}, err.status === 401
        ? 'Your token may have expired — update it in Settings.'
        : 'Check your connection and the repo name in Settings.'),
    );
  }
}

window.addEventListener('hashchange', route);
route();
