// Turn crawled X posts into Unfarm's public lists.
//   node scripts/build-lists.mjs crawler/raw/posts.json
// Writes data/fingerprints.json, data/farms.json and data/stats.json. Clusters
// from earlier runs are kept for 21 days after they were last seen.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { signature, sigToHex, hexToSig, Index, words } from '../extension/src/engine.js';

const KEEP_DAYS = 21;
const SIM = 0.5; // MinHash similarity that counts as the same post

const input = process.argv[2] || 'crawler/raw/posts.json';
const posts = JSON.parse(readFileSync(input, 'utf8'));
const prev = existsSync('data/fingerprints.json') ? JSON.parse(readFileSync('data/fingerprints.json', 'utf8')) : { clusters: [] };

const now = Math.floor(Date.now() / 1000);
const docs = [];
for (const p of posts) {
  const sig = signature(p.text);
  if (!sig) continue;
  docs.push({
    id: String(p.id),
    author: String(p.authorUsername || '').toLowerCase(),
    text: p.text,
    created: p.createdUtc || now,
    likes: p.likeCount || 0,
    views: p.viewCount || 0,
    url: p.url || `https://x.com/${p.authorUsername}/status/${p.id}`,
    sig,
  });
}

// Union-find over LSH candidate pairs from different authors.
const parent = docs.map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const idx = new Index();
docs.forEach((d, i) => {
  for (const m of idx.queryAll(d.sig, SIM)) {
    if (docs[m.data].author !== d.author) parent[find(i)] = find(m.data);
  }
  idx.add(d.sig, i);
});
const groups = new Map();
docs.forEach((d, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(d); });

// Merge with previous clusters (match by representative signature).
const prevIdx = new Index();
const prevClusters = (prev.clusters || []).filter((c) => now - (c.last_seen || 0) < KEEP_DAYS * 86400);
prevClusters.forEach((c, i) => prevIdx.add(hexToSig(c.sig), i));
const merged = prevClusters.map((c) => ({ ...c, authors: new Set(c.authors || []), examples: c.examples || [] }));

for (const g of groups.values()) {
  const authors = new Set(g.map((d) => d.author));
  if (authors.size < 2) continue;
  g.sort((a, b) => a.created - b.created);
  const rep = g[0];
  const m = prevIdx.query(rep.sig, SIM);
  let c;
  if (m) c = merged[m.data];
  else {
    c = { id: sigToHex(rep.sig).slice(0, 12), sig: sigToHex(rep.sig), sample: rep.text.slice(0, 280), authors: new Set(), examples: [], first_seen: rep.created, last_seen: rep.created, likes: 0, views: 0, posts: 0 };
    merged.push(c);
    prevIdx.add(rep.sig, merged.length - 1);
  }
  for (const d of g) {
    if (!c.examples.some((e) => e.id === d.id)) {
      c.examples.push({ id: d.id, author: d.author, url: d.url, created: d.created, likes: d.likes });
      c.likes = (c.likes || 0) + d.likes;
      c.views = (c.views || 0) + d.views;
    }
    c.authors.add(d.author);
    c.first_seen = Math.min(c.first_seen, d.created);
    c.last_seen = Math.max(c.last_seen, d.created);
  }
}

const clusters = merged
  .map((c) => ({ ...c, authors: [...c.authors].sort(), accounts: c.authors.size, posts: c.examples.length, examples: c.examples.sort((a, b) => a.created - b.created).slice(0, 40), example: c.examples[0]?.url }))
  .filter((c) => c.accounts >= 2)
  .sort((a, b) => b.accounts - a.accounts || b.likes - a.likes);

// Accounts that copy-pasted in at least 2 clusters, or 3+ times in total.
const farmCount = new Map();
for (const c of clusters) {
  const per = new Map();
  for (const e of c.examples) per.set(e.author, (per.get(e.author) || 0) + 1);
  for (const [a, n] of per) {
    const f = farmCount.get(a) || { handle: a, clusters: 0, copies: 0, cluster_ids: [] };
    f.clusters += 1; f.copies += n; f.cluster_ids.push(c.id);
    farmCount.set(a, f);
  }
}
const farms = [...farmCount.values()].filter((f) => f.clusters >= 2 || f.copies >= 3).sort((a, b) => b.copies - a.copies);

const stats = {
  updated: new Date(now * 1000).toISOString(),
  sampled_posts: posts.length,
  scored_posts: docs.length,
  copied_posts: clusters.reduce((a, c) => a + c.examples.filter((e) => now - e.created < 14 * 86400).length, 0),
  clusters: clusters.length,
  farms: farms.length,
  biggest: clusters[0] ? { accounts: clusters[0].accounts, sample: clusters[0].sample.slice(0, 120) } : null,
};
stats.copied_share = docs.length ? Number((groupsShare()).toFixed(4)) : 0;
function groupsShare() {
  let n = 0;
  for (const g of groups.values()) if (new Set(g.map((d) => d.author)).size >= 2) n += g.length;
  return n / docs.length;
}

const meta = { version: 1, updated: stats.updated, source: 'https://github.com/aluz123/unfarm' };
writeFileSync('data/fingerprints.json', JSON.stringify({ ...meta, clusters: clusters.map(({ examples, ...c }) => ({ ...c, examples: examples.slice(0, 12) })) }));
writeFileSync('data/farms.json', JSON.stringify({ ...meta, farms }));
writeFileSync('data/stats.json', JSON.stringify(stats, null, 1));
console.log(`posts ${posts.length} → scored ${docs.length}; clusters ${clusters.length}; farms ${farms.length}; copied share this run ${(stats.copied_share * 100).toFixed(1)}%`);
