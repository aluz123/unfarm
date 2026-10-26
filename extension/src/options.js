import { getSettings, saveSettings, getStats, emptyStats } from './settings.js';

const $ = (s) => document.querySelector(s);

async function render() {
  const s = await getSettings();
  document.querySelectorAll('[data-cat]').forEach((cb) => { cb.checked = !!s.categories[cb.dataset.cat]; });
  $('#wl').innerHTML = '';
  for (const h of s.whitelist) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button type="button">Remove</button>';
    li.querySelector('span').textContent = '@' + h;
    li.querySelector('button').addEventListener('click', async () => {
      await saveSettings({ whitelist: s.whitelist.filter((x) => x !== h) });
      render();
    });
    $('#wl').appendChild(li);
  }
  if (!s.whitelist.length) $('#wl').innerHTML = '<li class="muted">No accounts yet. Use “Not slop” on a hidden post, or add one here.</li>';
  const st = await getStats();
  $('#totals').textContent = `Today: ${st.hidden} of ${st.scanned} posts hidden. Since install: ${st.total.hidden} of ${st.total.scanned}.`;
}

document.querySelectorAll('[data-cat]').forEach((cb) => cb.addEventListener('change', async () => {
  await saveSettings({ categories: { [cb.dataset.cat]: cb.checked } });
}));

$('#wlBtn').addEventListener('click', async () => {
  const h = $('#wlAdd').value.trim().replace(/^@/, '').toLowerCase();
  if (!/^\w{1,15}$/.test(h)) return;
  const s = await getSettings();
  await saveSettings({ whitelist: [...new Set([...s.whitelist, h])] });
  $('#wlAdd').value = '';
  render();
});

$('#reset').addEventListener('click', async () => {
  const st = await getStats();
  await chrome.storage.local.set({ stats: { ...emptyStats(), total: st.total } });
  render();
});

render();
