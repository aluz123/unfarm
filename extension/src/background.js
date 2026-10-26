import { fetchLists } from './settings.js';

const ALARM = 'unfarm-refresh';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  await fetchLists();
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM, { periodInMinutes: 360 });
  const { lists } = await chrome.storage.local.get('lists');
  if (!lists || Date.now() - (lists.fetched || 0) > 6 * 3600 * 1000) await fetchLists();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === ALARM) await fetchLists();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'refresh-lists') {
    fetchLists().then((l) => reply({ ok: true, clusters: l.fingerprints?.clusters?.length || 0, farms: l.farms?.farms?.length || 0 }))
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
