import { getSettings, saveSettings, getStats, SITE } from './settings.js';

const $ = (s) => document.querySelector(s);
const HINTS = {
  gentle: 'Copy-paste farms and known farm accounts, plus only the most blatant bait.',
  balanced: 'Farms plus clear AI engagement bait. Recommended.',
  strict: 'Also hides softer bait like “save this” listicles.',
};
const KIND_LABELS = { copypasta: 'Copy-pasted posts', farm: 'Farm accounts', bait: 'AI engagement bait' };

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

async function render() {
  const s = await getSettings();
  const st = await getStats();
  $('#enabled').checked = s.enabled;
  document.querySelectorAll('#sens button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.sensitivity)));
  document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.mode)));
  $('#sensHint').textContent = HINTS[s.sensitivity];
  if (st.scanned) {
    $('#pct').textContent = pct(st.hidden, st.scanned) + '%';
    $('#sub').textContent = `of your X feed today was slop: ${st.hidden} of ${st.scanned} posts hidden.`;
  } else {
    $('#pct').textContent = '0%';
    $('#sub').textContent = 'Nothing scanned yet today. Open x.com and scroll.';
  }
  const max = Math.max(1, ...Object.values(st.kinds));
  $('#kinds').innerHTML = Object.entries(KIND_LABELS).map(([k, l]) => `<div class="kind"><span>${l}</span><span class="bar"><i style="width:${(st.kinds[k] || 0) / max * 100}%"></i></span><b>${st.kinds[k] || 0}</b></div>`).join('');
  const text = st.scanned
    ? `Unfarm hid ${st.hidden} of ${st.scanned} posts (${pct(st.hidden, st.scanned)}%) from my X feed today: copy-paste farms and AI engagement bait. Free and open source: ${SITE}`
    : `Unfarm hides copy-paste engagement farms and AI bait on X, with receipts. Free and open source: ${SITE}`;
  $('#tweet').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text);
  const { lists } = await chrome.storage.local.get('lists');
  if (lists) {
    const ago = Math.max(0, Math.round((Date.now() - (lists.fetched || 0)) / 3600000));
    const upd = lists.fingerprints?.updated ? new Date(lists.fingerprints.updated) : null;
    $('#lists').textContent = `Farm list: ${lists.fingerprints?.clusters?.length || 0} copy-paste clusters · ${lists.farms?.farms?.length || 0} accounts · ${upd ? 'built ' + upd.toLocaleDateString() : ''} · checked ${ago}h ago`;
  } else {
    $('#lists').textContent = 'Farm list not downloaded yet.';
  }
}

$('#enabled').addEventListener('change', async (e) => { await saveSettings({ enabled: e.target.checked }); render(); });
document.querySelectorAll('#sens button').forEach((b) => b.addEventListener('click', async () => { await saveSettings({ sensitivity: b.dataset.v }); render(); }));
document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', async () => { await saveSettings({ mode: b.dataset.v }); render(); }));
$('#refresh').addEventListener('click', async () => {
  $('#lists').textContent = 'Updating…';
  const r = await chrome.runtime.sendMessage({ type: 'refresh-lists' });
  if (!r?.ok) $('#lists').textContent = 'Update failed. Try again later.';
  render();
});

$('#share').addEventListener('click', async () => {
  const st = await getStats();
  const canvas = drawCard(st);
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      $('#share').textContent = 'Image copied. Paste it into a post.';
    } catch (e) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'unfarm-slop-score.png';
      a.click();
      $('#share').textContent = 'Image downloaded.';
    }
    setTimeout(() => { $('#share').textContent = 'Share my slop score'; }, 2500);
  }, 'image/png');
});

function drawCard(st) {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  x.fillStyle = '#14110f'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e2702d'; x.fillRect(0, 0, W, 10);
  x.fillStyle = '#b9b2ab'; x.font = `600 28px ${font}`;
  x.fillText('MY X FEED TODAY', 80, 110);
  const p = st.scanned ? Math.round(st.hidden / st.scanned * 100) : 0;
  x.fillStyle = '#ffffff'; x.font = `800 200px ${font}`;
  x.fillText(p + '%', 72, 320);
  x.font = `600 40px ${font}`;
  x.fillText('was AI slop and copy-paste farms', 80, 390);
  x.fillStyle = '#b9b2ab'; x.font = `500 30px ${font}`;
  x.fillText(`${st.hidden} of ${st.scanned} posts hidden · ${st.kinds.copypasta || 0} copy-pasted · ${st.kinds.farm || 0} from farm accounts · ${st.kinds.bait || 0} bait`, 80, 450);
  x.fillStyle = '#e2702d'; x.font = `700 32px ${font}`;
  x.fillText('Unfarm', 80, 560);
  x.fillStyle = '#b9b2ab'; x.font = `500 28px ${font}`;
  x.fillText('free, open source · aluz123.github.io/unfarm', 200, 560);
  return c;
}

render();
