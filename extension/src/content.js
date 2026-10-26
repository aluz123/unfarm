// Unfarm content script for x.com. Classic script: modules are loaded with
// dynamic import so the same engine runs here, on the website and in tests.
(async () => {
  const E = await import(chrome.runtime.getURL('src/engine.js'));
  const S = await import(chrome.runtime.getURL('src/settings.js'));

  let settings = await S.getSettings();
  let listIndex = new E.Index();
  let farms = new Set();
  let farmInfo = new Map();
  const seen = new E.Index(); // posts seen this session, for local copy-paste detection
  let stats = await S.getStats();
  let dirty = false;

  async function loadLists() {
    let { lists } = await chrome.storage.local.get('lists');
    if (!lists) {
      try {
        const [fp, fa] = await Promise.all(['fingerprints.json', 'farms.json'].map((n) => fetch(chrome.runtime.getURL('data/' + n)).then((r) => r.json())));
        lists = { fingerprints: fp, farms: fa };
      } catch (e) { lists = { fingerprints: { clusters: [] }, farms: { farms: [] } }; }
    }
    listIndex = E.indexFromList(lists.fingerprints);
    farms = new Set((lists.farms?.farms || []).map((f) => f.handle.toLowerCase()));
    farmInfo = new Map((lists.farms?.farms || []).map((f) => [f.handle.toLowerCase(), f]));
  }
  await loadLists();

  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.settings) { settings = await S.getSettings(); rescanAll(); }
    if (changes.lists) { await loadLists(); rescanAll(); }
  });

  // ---------- reading posts from X's DOM (2026 markup has no data-testid) ----------
  function extract(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')].find((a) => a.closest('article') === article);
    const m = link?.getAttribute('href')?.match(/^\/([^/]+)\/status\/(\d+)/);
    const img = [...article.querySelectorAll('img[alt^="@"]')].find((i) => i.closest('article') === article);
    let author = img?.alt?.slice(1) || m?.[1] || '';
    const textEl = [...article.querySelectorAll('div[dir="auto"]')].find((d) => d.closest('article') === article && !d.closest('a') && (d.innerText || '').trim().length > 0);
    return { id: m?.[2] || '', author: author.toLowerCase(), text: textEl ? textEl.innerText : '', textEl };
  }

  // ---------- applying a verdict ----------
  function clear(article) {
    article.classList.remove('unfarm-hidden', 'unfarm-labeled', 'unfarm-removed');
    article.querySelector(':scope > .unfarm-banner')?.remove();
  }

  function reasonText(reasons) {
    const order = { farm: 0, copypasta: 1, 'copypasta-local': 2, bait: 3 };
    return reasons.slice().sort((a, b) => order[a.kind] - order[b.kind]).map((r) => r.label).filter(Boolean).slice(0, 2).join(' · ');
  }

  function apply(article, post, verdict) {
    clear(article);
    if (verdict.verdict !== 'hide') return;
    if (settings.mode === 'remove') { article.classList.add('unfarm-removed'); return; }
    const banner = document.createElement('div');
    banner.className = 'unfarm-banner';
    const cluster = verdict.reasons.find((r) => r.kind === 'copypasta')?.cluster;
    const farm = verdict.reasons.find((r) => r.kind === 'farm');
    const receipts = cluster ? `${S.SITE}#c=${cluster.id}` : farm ? `${S.SITE}#a=${encodeURIComponent(post.author)}` : null;
    banner.innerHTML = `<span class="unfarm-mark" aria-hidden="true"></span><span class="unfarm-why"></span><span class="unfarm-actions">${receipts ? '<a class="unfarm-btn" target="_blank" rel="noopener">Receipts</a>' : ''}<button class="unfarm-btn" data-act="show" type="button">Show</button><button class="unfarm-btn" data-act="trust" type="button">Not slop</button></span>`;
    banner.querySelector('.unfarm-why').textContent = (settings.mode === 'label' ? 'Unfarm: ' : 'Hidden by Unfarm: ') + reasonText(verdict.reasons);
    if (receipts) banner.querySelector('a').href = receipts;
    banner.addEventListener('click', async (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      e.preventDefault(); e.stopPropagation();
      if (act === 'show') { article.classList.remove('unfarm-hidden'); article.classList.add('unfarm-labeled'); e.target.remove(); }
      if (act === 'trust' && post.author) {
        const wl = new Set(settings.whitelist || []); wl.add(post.author);
        await S.saveSettings({ whitelist: [...wl] });
      }
    }, true);
    article.prepend(banner);
    article.classList.add(settings.mode === 'label' ? 'unfarm-labeled' : 'unfarm-hidden');
  }

  // ---------- processing ----------
  function process(article) {
    const post = extract(article);
    if (!post.text || !post.id) return;
    const key = post.id + ':' + settings.sensitivity + ':' + settings.mode + ':' + settings.enabled;
    if (article.dataset.unfarm === key) return;
    const firstTime = article.dataset.unfarmId !== post.id;
    article.dataset.unfarm = key;
    article.dataset.unfarmId = post.id;
    if (!settings.enabled || (settings.whitelist || []).includes(post.author)) { clear(article); return; }
    const verdict = E.classify(post, { listIndex, farms, farmInfo, seen, sensitivity: settings.sensitivity, enabled: settings.categories });
    if (verdict.sig && firstTime && !seen.query(verdict.sig, 0.95)) seen.add(verdict.sig, { author: post.author, id: post.id });
    apply(article, post, verdict);
    if (firstTime) {
      const t = S.today();
      if (stats.date !== t) stats = { ...S.emptyStats(), total: stats.total };
      stats.scanned++; stats.total.scanned++;
      if (verdict.verdict === 'hide') {
        stats.hidden++; stats.total.hidden++;
        const kinds = new Set(verdict.reasons.map((r) => (r.kind === 'copypasta-local' ? 'copypasta' : r.kind)));
        for (const k of kinds) stats.kinds[k] = (stats.kinds[k] || 0) + 1;
      }
      dirty = true;
    }
  }

  function rescanAll() {
    document.querySelectorAll('article').forEach((a) => { delete a.dataset.unfarm; process(a); });
  }

  let queued = false;
  const pending = new Set();
  function schedule(nodes) {
    for (const n of nodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'ARTICLE') pending.add(n);
      n.querySelectorAll?.('article').forEach((a) => pending.add(a));
      const up = n.closest?.('article');
      if (up) pending.add(up);
    }
    if (!queued && pending.size) {
      queued = true;
      (window.requestIdleCallback || setTimeout)(() => {
        queued = false;
        const list = [...pending]; pending.clear();
        for (const a of list) { try { process(a); } catch (e) { /* never break the page */ } }
      }, { timeout: 300 });
    }
  }

  new MutationObserver((muts) => {
    const nodes = [];
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => nodes.push(n));
      else if (m.type === 'characterData') nodes.push(m.target.parentElement);
    }
    schedule(nodes);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule([document.body]);

  setInterval(async () => {
    if (!dirty) return;
    dirty = false;
    try { await chrome.storage.local.set({ stats }); } catch (e) { /* extension reloaded */ }
  }, 2000);
})();
