// End-to-end check on live x.com: start Chrome with the unpacked extension
// (via the DevTools protocol), open a page, and report what Unfarm did.
//   node scripts/e2e-live.mjs https://x.com/someaccount [screenshot.png]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const url = process.argv[2] || 'https://x.com/Zayan_coder9';
const shot = process.argv[3];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'unfarm-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--enable-unsafe-extension-debugging', '--remote-allow-origins=*', `--user-data-dir=${profile}`, `--window-size=${process.env.WINDOW || '1100,2400'}`, '--no-first-run', '--no-default-browser-check', '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { r, j } = pending.get(d.id); pending.delete(d.id); d.error ? j(new Error(JSON.stringify(d.error))) : r(d.result); } };
  return { send: (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }), close: () => ws.close() };
}

try {
  let ver;
  for (let i = 0; i < 50; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(200); } }
  const b = await cdp(ver.webSocketDebuggerUrl);
  const ext = await b.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const { targetId } = await b.send('Target.createTarget', { url });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  await b.send('Runtime.enable', {}, sessionId);
  let result;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const r = await b.send('Runtime.evaluate', { expression: `(() => { const arts = [...document.querySelectorAll('article')]; return JSON.stringify({ articles: arts.length, processed: arts.filter(a => a.dataset.unfarmId).length, hidden: arts.filter(a => a.classList.contains('unfarm-hidden')).length, reasons: [...document.querySelectorAll('.unfarm-why')].map(e => e.textContent), title: document.title }); })()`, returnByValue: true }, sessionId);
    result = JSON.parse(r.result.value);
    if (result.processed && result.processed >= result.articles && result.articles >= 3) break;
  }
  if (shot) {
    const s = await b.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(shot, Buffer.from(s.data, 'base64'));
  }
  console.log(JSON.stringify({ extensionId: ext.id, url, ...result }, null, 1));
  b.close();
} finally {
  chrome.kill('SIGKILL');
}
