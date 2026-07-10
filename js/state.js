// Tiny shared session state (workspace list for the sidebar, cached user).
import { listDir, getUser } from './github.js';
import { cached } from './cache.js';

export const state = {
  workspaces: [],
  workspacesLoaded: false,
  user: null,
};

const IGNORED = new Set(['assets', '.github', 'starter']);

// Resolves with the cached list when there is one (a background refetch
// updates state and fires onChange if the list actually changed).
export async function refreshWorkspaces(onChange) {
  const apply = (names) => {
    state.workspaces = names;
    state.workspacesLoaded = true;
  };
  const names = await cached('workspaces', async () => {
    const items = await listDir('');
    return items
      .filter((i) => i.type === 'dir' && !i.name.startsWith('.') && !IGNORED.has(i.name))
      .map((i) => i.name)
      .sort((a, b) => (a === 'Project' ? -1 : b === 'Project' ? 1 : a.localeCompare(b)));
  }, (fresh) => { apply(fresh); if (onChange) onChange(); });
  apply(names);
  return names;
}

export async function currentUser() {
  if (!state.user) state.user = await getUser();
  return state.user;
}
