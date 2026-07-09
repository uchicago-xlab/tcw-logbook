// Tiny stale-while-revalidate cache over sessionStorage: views render
// instantly from the last known data while a background refetch runs, and
// onFresh fires only when the data actually changed. Session-scoped on
// purpose — a reload starts warm, a new tab starts clean.
import { loadConfig } from './config.js';

function fullKey(key) {
  const { repo, root } = loadConfig();
  return `logbook:${repo || ''}:${root || ''}:${key}`;
}

function write(key, json) {
  try { sessionStorage.setItem(fullKey(key), json); } catch { /* quota — just skip caching */ }
}

export function invalidate(key) {
  sessionStorage.removeItem(fullKey(key));
}

export function clearCache() {
  Object.keys(sessionStorage)
    .filter((k) => k.startsWith('logbook:'))
    .forEach((k) => sessionStorage.removeItem(k));
}

// Fetch and store. Resolves with the fresh data if it differs from the
// cached copy, undefined when nothing changed.
export async function revalidate(key, fetcher) {
  const data = await fetcher();
  const json = JSON.stringify(data);
  if (json === sessionStorage.getItem(fullKey(key))) return undefined;
  write(key, json);
  return data;
}

// Cached value immediately (revalidating in the background), or await the
// fetcher on a cold miss. onFresh(data) fires only if the background
// refetch found a change — callers decide whether redrawing is safe.
export async function cached(key, fetcher, onFresh) {
  const raw = sessionStorage.getItem(fullKey(key));
  if (raw != null) {
    try {
      const hit = JSON.parse(raw);
      revalidate(key, fetcher)
        .then((fresh) => { if (fresh !== undefined && onFresh) onFresh(fresh); })
        .catch(() => { /* stale is fine until the next successful refetch */ });
      return hit;
    } catch { invalidate(key); }
  }
  const data = await fetcher();
  write(key, JSON.stringify(data));
  return data;
}
