// Shared settings, stats and list helpers for the extension pages.

export const LIST_BASE = 'https://aluz123.github.io/unfarm/data/';
export const SITE = 'https://aluz123.github.io/unfarm/';

export const DEFAULTS = {
  enabled: true,
  sensitivity: 'balanced', // gentle | balanced | strict
  mode: 'collapse',        // collapse | label | remove
  categories: { copypasta: true, farms: true, bait: true },
  whitelist: [],
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}), categories: { ...DEFAULTS.categories, ...(settings?.categories || {}) } };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, categories: { ...cur.categories, ...(patch.categories || {}) } };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyStats() {
  return { date: today(), scanned: 0, hidden: 0, kinds: { copypasta: 0, farm: 0, bait: 0 }, total: { scanned: 0, hidden: 0 } };
}

export async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  if (!stats) return emptyStats();
  if (stats.date !== today()) return { ...emptyStats(), total: stats.total || { scanned: 0, hidden: 0 } };
  return stats;
}

/** Fetch the latest public lists; fall back to the copies bundled with the extension. */
export async function fetchLists() {
  const get = async (name) => {
    try {
      const r = await fetch(LIST_BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (e) { /* offline or blocked: use the bundled copy */ }
    const r = await fetch(chrome.runtime.getURL('data/' + name));
    return r.json();
  };
  const [fingerprints, farms] = await Promise.all([get('fingerprints.json'), get('farms.json')]);
  const lists = { fingerprints, farms, fetched: Date.now() };
  await chrome.storage.local.set({ lists });
  return lists;
}
