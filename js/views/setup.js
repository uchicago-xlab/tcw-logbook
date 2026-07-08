// First-run setup / settings: data repo + fine-grained personal access token.
import { h } from '../ui.js';
import { loadConfig, saveConfig, clearConfig } from '../config.js';
import { getUser, getRepo } from '../github.js';
import { state } from '../state.js';

export function renderSetup(onDone) {
  const cfg = loadConfig();

  const repoInput = h('input', {
    type: 'text', placeholder: 'your-org/research-notes', value: cfg.repo || '',
    autocomplete: 'off', spellcheck: 'false',
  });
  const tokenInput = h('input', {
    type: 'password', placeholder: 'github_pat_…', value: cfg.token || '',
    autocomplete: 'off',
  });
  const rootInput = h('input', {
    type: 'text', placeholder: 'e.g. notes (optional)', value: cfg.root || '',
    autocomplete: 'off', spellcheck: 'false',
  });
  const errBox = h('div');
  const btn = h('button', { class: 'primary' }, 'Connect');

  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    errBox.className = '';
    btn.disabled = true;
    btn.textContent = 'Checking…';
    saveConfig({
      repo: repoInput.value.trim(),
      token: tokenInput.value.trim(),
      root: rootInput.value.trim().replace(/^\/+|\/+$/g, ''),
    });
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
          ? `Token works, but it can't see "${repoInput.value.trim()}". Check the repo name, and that the token was granted access to this specific repository.`
          : `Couldn't connect: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });

  return h('div.setup-shell', {},
    h('div.logo', {}, 'Logbook'),
    h('p', { style: 'color:var(--muted)' },
      'Your team’s research notes and tasks, stored in a GitHub repo. One-time setup, takes about two minutes.'),

    h('div.card', {},
      h('label', {}, '1. Team data repository'),
      repoInput,
      h('div.hint', {}, 'The private repo where notes and tasks live, as owner/name.'),

      h('label', {}, '2. Your personal access token'),
      tokenInput,
      h('div.hint', { html:
        'Create one at GitHub → Settings → Developer settings → ' +
        '<b>Fine-grained tokens</b> → Generate new token. Set <b>Repository access</b> to ' +
        'only the repo above, and under Permissions grant <b>Contents: Read and write</b> ' +
        'and <b>Issues: Read and write</b>. The token stays in this browser only.' }),

      h('label', {}, '3. Notes folder — only if notes share a repo with code'),
      rootInput,
      h('div.hint', {},
        'Leave blank if the whole repo is for notes. If the repo also holds code, ' +
        'put notes under a subfolder (e.g. "notes") and name it here — workspaces, ' +
        'pages, and the activity feed will all stay inside it.'),

      h('div', { style: 'margin-top:18px' }, btn),
      errBox,
    ),

    loadConfig().token ? h('div', { style: 'text-align:center' },
      h('button', {
        onclick: () => { clearConfig(); location.reload(); },
      }, 'Sign out / clear saved token'),
    ) : null,
  );
}
