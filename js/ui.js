// Tiny DOM helpers — Logbook's entire "framework".

// h('div.card', {onclick: fn}, child1, child2, ...)
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function timeago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

export function spinner(label = 'Loading…') {
  return h('div.spinner', {}, h('div.dot'), label);
}

// Pulsing placeholder lines for content that is still loading.
export function skeleton(lines = 3) {
  return h('div.skeleton', {}, Array.from({ length: lines }, () => h('div.skeleton-line')));
}

// Render a placeholder now; swap in render(data) when the promise lands,
// or a muted error line if it rejects. Safe if the user has navigated
// away — filling a detached node is a no-op.
export function slot(promise, render, placeholder = skeleton()) {
  const el = h('div', {}, placeholder);
  promise
    .then((data) => { clear(el).append(render(data)); })
    .catch((err) => { clear(el).append(h('div.hint', {}, `Couldn't load: ${String(err.message || err)}`)); });
  return el;
}

// Status chip used for both pages and tasks.
export function chip(status) {
  if (!status) return null;
  return h('span', { class: `chip chip-${status}` }, status);
}
