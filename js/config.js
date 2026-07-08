// Local, per-browser configuration. Nothing here ever leaves the user's machine
// except the token being sent to api.github.com over HTTPS.
const KEY = 'logbook.config';

// This deployment is pinned to the team's data repo — members only supply a
// token. Deploying for another team means changing these two values.
export const FIXED = {
  repo: 'uchicago-xlab/TeachingClaudeWhy',
  root: 'notes',
};

export function loadConfig() {
  try {
    return { ...(JSON.parse(localStorage.getItem(KEY)) || {}), ...FIXED };
  } catch {
    return { ...FIXED };
  }
}

export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg;
}

export function clearConfig() {
  localStorage.removeItem(KEY);
}

export function apiBase() {
  // Overridable so the test harness can point the app at a mock API.
  return loadConfig().apiBase || 'https://api.github.com';
}

export function isConfigured() {
  const c = loadConfig();
  return Boolean(c.token && c.repo);
}
