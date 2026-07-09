// First-run setup / settings: paste a fine-grained personal access token.
// The data repo and notes folder are pinned in config.js (FIXED).
import { h } from '../ui.js';
import { FIXED, loadConfig, saveConfig, clearConfig } from '../config.js';
import { clearCache } from '../cache.js';
import { getUser, getRepo } from '../github.js';
import { state } from '../state.js';

export function renderSetup(onDone) {
  const cfg = loadConfig();

  const tokenInput = h('input', {
    type: 'password', placeholder: 'github_pat_…', value: cfg.token || '',
    autocomplete: 'off',
  });
  const errBox = h('div');
  const btn = h('button', { class: 'primary' }, 'Connect');

  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    errBox.className = '';
    btn.disabled = true;
    btn.textContent = 'Checking…';
    saveConfig({ token: tokenInput.value.trim() });
    try {
      const user = await getUser();
      await getRepo(); // throws if the token can't see the repo
      state.workspacesLoaded = false;
      state.user = user;
      onDone();
    } catch (err) {
      errBox.className = 'error-box';
      errBox.textContent = err.status === 401
        ? 'GitHub rejected the token. Double-check you copied the whole thing.'
        : err.status === 404
          ? `Token works, but it can't see ${FIXED.repo}. When creating it, set Resource owner to ${FIXED.repo.split('/')[0]} and grant access to that specific repository (step 2 below).`
          : `Couldn't connect: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });

  const [owner, repoName] = FIXED.repo.split('/');

  return h('div.setup-shell', {},
    h('div.logo', {}, 'Logbook'),
    h('p', { style: 'color:var(--muted)' },
      'The team’s research notes and tasks. Paste your GitHub token to ' +
      'connect — one-time setup, takes about two minutes.'),

    h('div.card', {},
      h('label', {}, 'Your personal access token'),
      tokenInput,
      h('div.hint', { html:
        '<b>How to get one:</b>' +
        '<ol style="margin:6px 0 0 18px; padding:0; display:grid; gap:4px">' +
        '<li>Open <a href="https://github.com/settings/personal-access-tokens/new" ' +
        'target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> ' +
        '(GitHub → Settings → Developer settings → Fine-grained tokens).</li>' +
        `<li>Set <b>Resource owner</b> to <b>${owner}</b> — not your personal ` +
        'account. This is the step everyone misses.</li>' +
        '<li><b>Repository access</b>: <i>Only select repositories</i> → ' +
        `<b>${repoName}</b>.</li>` +
        '<li>Under <b>Permissions → Repository permissions</b>, grant ' +
        '<b>Contents: Read and write</b> and <b>Issues: Read and write</b>. ' +
        'Nothing else.</li>' +
        '<li>Generate, copy the <code>github_pat_…</code> string, paste it above.</li>' +
        '</ol>' +
        'The token stays in this browser only and is sent exclusively to GitHub.' }),

      h('div', { style: 'margin-top:18px' }, btn),
      errBox,
    ),

    loadConfig().token ? h('div', { style: 'text-align:center' },
      h('button', {
        onclick: () => { clearConfig(); clearCache(); location.reload(); },
      }, 'Sign out / clear saved token'),
    ) : null,
  );
}
