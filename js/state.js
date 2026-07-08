// Tiny shared session state (workspace list for the sidebar, cached user).
import { listDir, getUser } from './github.js';

export const state = {
  workspaces: [],
  workspacesLoaded: false,
  user: null,
};

const IGNORED = new Set(['assets', '.github', 'starter']);

export async function refreshWorkspaces() {
  const items = await listDir('');
  state.workspaces = items
    .filter((i) => i.type === 'dir' && !i.name.startsWith('.') && !IGNORED.has(i.name))
    .map((i) => i.name)
    .sort((a, b) => (a === 'project' ? -1 : b === 'project' ? 1 : a.localeCompare(b)));
  state.workspacesLoaded = true;
  return state.workspaces;
}

export async function currentUser() {
  if (!state.user) state.user = await getUser();
  return state.user;
}
