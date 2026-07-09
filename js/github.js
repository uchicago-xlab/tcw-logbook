// Thin client for the slice of the GitHub REST API Logbook uses.
// Everything in the app goes through these functions.
import { loadConfig, apiBase } from './config.js';

class GhError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const { token, repo } = loadConfig();
  const url = path.startsWith('http') ? path : `${apiBase()}${path.replace('{repo}', repo || '')}`;
  const res = await fetch(url, {
    method,
    // GitHub sends Cache-Control: max-age=60; without no-store the browser
    // serves stale lists (e.g. the task board) for up to a minute after edits.
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    throw new GhError(res.status, msg);
  }
  return raw ? res : res.json();
}

// ---------- UTF-8 <-> base64 ----------
export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------- identity / repo ----------
export const getUser = () => gh('/user');
export const getRepo = () => gh('/repos/{repo}');
export const getCollaborators = () => gh('/repos/{repo}/collaborators?per_page=100');

// ---------- contents ----------
// All content paths are relative to the configured root folder (if any), so
// notes can live in e.g. notes/ inside a bigger project repo. Routes, links,
// and views never see the prefix.
export function withRoot(path) {
  const root = (loadConfig().root || '').replace(/^\/+|\/+$/g, '');
  if (!root) return path;
  return path ? `${root}/${path}` : root;
}

export async function listDir(path = '') {
  const items = await gh(`/repos/{repo}/contents/${encodePath(withRoot(path))}`);
  return (Array.isArray(items) ? items : [items]).map(stripRoot);
}

export async function getFile(path) {
  const f = await gh(`/repos/{repo}/contents/${encodePath(withRoot(path))}`);
  return { text: b64decode(f.content), sha: f.sha, path: stripRoot(f).path };
}

// Binary file (e.g. an image) as an object URL the browser can display.
export async function getFileAsObjectURL(path) {
  const f = await gh(`/repos/{repo}/contents/${encodePath(withRoot(path))}`);
  const bin = atob(f.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes]));
}

export async function putFile(path, text, message, sha) {
  return gh(`/repos/{repo}/contents/${encodePath(withRoot(path))}`, {
    method: 'PUT',
    body: { message, content: b64encode(text), ...(sha ? { sha } : {}) },
  });
}

function stripRoot(item) {
  const root = (loadConfig().root || '').replace(/^\/+|\/+$/g, '');
  if (!root || !item.path) return item;
  return { ...item, path: item.path.replace(new RegExp(`^${root}/`), '') };
}

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

// ---------- issues (tasks) ----------
export const listIssues = (state = 'open') =>
  gh(`/repos/{repo}/issues?state=${state}&per_page=100`);

export const createIssue = (title, { assignees = [], labels = [], body = '' } = {}) =>
  gh('/repos/{repo}/issues', { method: 'POST', body: { title, assignees, labels, body } });

export const updateIssue = (number, patch) =>
  gh(`/repos/{repo}/issues/${number}`, { method: 'PATCH', body: patch });

// ---------- activity ----------
// When a root folder is configured, only show commits touching it, so a
// shared project repo's code commits don't drown out note activity.
export function listCommits(n = 15) {
  const root = (loadConfig().root || '').replace(/^\/+|\/+$/g, '');
  return gh(`/repos/{repo}/commits?per_page=${n}${root ? `&path=${encodeURIComponent(root)}` : ''}`);
}
