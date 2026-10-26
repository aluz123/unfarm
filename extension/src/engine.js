// Unfarm engine: text normalization, MinHash fingerprints and AI-bait rules.
// Plain ES module with no dependencies. The extension, the website, the list
// builder and the tests all import this same file, so a post gets the same
// fingerprint everywhere.

export const VERSION = 1;
export const NUM_HASHES = 64;
export const BANDS = 16; // 16 bands x 4 rows
export const ROWS = NUM_HASHES / BANDS;
export const MIN_WORDS = 12;
// X truncates long posts in the timeline ("Show more"), so fingerprints use
// only the opening words. Copy-pasted posts share their opening.
export const HEAD_WORDS = 40;

// ---------- normalization ----------

/** Lowercase, fold fancy Unicode letters, drop links/mentions/emoji/punctuation. */
export function normalize(text) {
  let t = String(text || '').normalize('NFKC').toLowerCase();
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/(^|\s)[@#][\w]+/g, ' ');
  t = t.replace(/[’']/g, '');
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function words(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function shingles(ws, k = 3) {
  const out = new Set();
  if (ws.length < k) { if (ws.length) out.add(ws.join(' ')); return out; }
  for (let i = 0; i + k <= ws.length; i++) out.add(ws.slice(i, i + k).join(' '));
  return out;
}

// ---------- MinHash ----------

// 32-bit FNV-1a, seeded.
function fnv(str, seed) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // final avalanche so nearby seeds give independent hashes
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const SEEDS = Array.from({ length: NUM_HASHES }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

/** MinHash signature (array of 64 uint32) of a text, or null if it's too short. */
export function signature(text) {
  const ws = words(text).slice(0, HEAD_WORDS);
  if (ws.length < MIN_WORDS) return null;
  const sh = shingles(ws);
  const sig = new Array(NUM_HASHES).fill(0xffffffff);
  for (const s of sh) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = fnv(s, SEEDS[i]);
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

export function similarity(a, b) {
  if (!a || !b) return 0;
  let eq = 0;
  for (let i = 0; i < NUM_HASHES; i++) if (a[i] === b[i]) eq++;
  return eq / NUM_HASHES;
}

export function sigToHex(sig) {
  return sig.map((x) => x.toString(16).padStart(8, '0')).join('');
}

export function hexToSig(hex) {
  const out = new Array(NUM_HASHES);
  for (let i = 0; i < NUM_HASHES; i++) out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return out;
}

export function bandKeys(sig) {
  const keys = [];
  for (let b = 0; b < BANDS; b++) keys.push(b + ':' + sig.slice(b * ROWS, b * ROWS + ROWS).join('.'));
  return keys;
}

/** In-memory LSH index of signatures. */
export class Index {
  constructor() { this.buckets = new Map(); this.items = []; }
  add(sig, data) {
    const id = this.items.length;
    this.items.push({ sig, data });
    for (const k of bandKeys(sig)) {
      let arr = this.buckets.get(k);
      if (!arr) this.buckets.set(k, (arr = []));
      arr.push(id);
    }
    return id;
  }
  /** Best match at or above `min` similarity, or null. */
  query(sig, min = 0.5) {
    if (!sig) return null;
    const seen = new Set();
    let best = null;
    for (const k of bandKeys(sig)) {
      const arr = this.buckets.get(k);
      if (!arr) continue;
      for (const id of arr) {
        if (seen.has(id)) continue;
        seen.add(id);
        const s = similarity(sig, this.items[id].sig);
        if (s >= min && (!best || s > best.similarity)) best = { similarity: s, data: this.items[id].data, id };
      }
    }
    return best;
  }
  /** All matches at or above `min`. */
  queryAll(sig, min = 0.5) {
    if (!sig) return [];
    const seen = new Set();
    const out = [];
    for (const k of bandKeys(sig)) {
      const arr = this.buckets.get(k);
      if (!arr) continue;
      for (const id of arr) {
        if (seen.has(id)) continue;
        seen.add(id);
        const s = similarity(sig, this.items[id].sig);
        if (s >= min) out.push({ similarity: s, data: this.items[id].data, id });
      }
    }
    return out;
  }
}

// ---------- AI-bait rules ----------
// Each rule has a weight: 3 = strong tell, 2 = medium, 1 = weak.
// Rules run on the raw text (case-insensitive) and on its first line.

const F = String.raw`f(?:[\*\.\-_]{1,4}|u|\*u)?(?:c|\*)?(?:k|\*)?(?:i|\*)?(?:n|\*)?g?`;

export const RULES = [
  // hype hooks
  { id: 'hype-insane', label: '“This is f*cking insane” hook', weight: 3, re: new RegExp(String.raw`\bthis is (?:(?:a|an|so|pure|real|actual|actually|absolutely|literally)\s+)*(?:${F}\s+)?(?:insane|gold|goldmine|wild|crazy|nuts)\b`, 'i'), first: true },
  { id: 'hype-fword-start', label: 'Shock-word opener', weight: 2, re: new RegExp(String.raw`^\W*(?:holy (?:sh[i\*]t|f[\*u]{0,3}c?k)|${F} insane|wtf)[\W]*\s`, 'i'), first: true },
  { id: 'hype-illegal', label: '“Feels illegal to know” hook', weight: 3, re: /\b(?:should (?:honestly |literally )?be illegal|feels? illegal|this should not be legal|shouldn'?t be (?:legal|free))\b/i },
  { id: 'hype-break-internet', label: '“Break the internet” hook', weight: 3, re: /\b(?:going to|about to|will) break the internet\b/i },
  { id: 'hype-nobody', label: '“Nobody is talking about this”', weight: 2, re: /\b(?:nobody|no one)(?:'?s| is) talking about (?:this|it)\b/i },
  { id: 'hype-mindblown', label: 'Mind-blown opener', weight: 1, re: /^[^\n]{0,80}🤯/u, first: true },

  // authority-quote and course bait
  { id: 'quote-bait', label: 'Celebrity-quote bait', weight: 2, re: /^\W*(?:sam altman|elon musk|jensen huang|dario amodei|demis hassabis|mark zuckerberg|satya nadella|sundar pichai|andrej karpathy|(?:an? )?(?:anthropic|openai|google|meta|spacexai|xai|nvidia|deepmind|apple) (?:engineer|researcher|ceo|cto|employee))(?:\s*\([^)]{0,40}\))?\s*:/i, first: true },
  { id: 'netflix', label: '“Instead of Netflix” hook', weight: 3, re: /\binstead of (?:watching )?netflix\b/i },
  { id: 'listicle', label: 'Big-number listicle', weight: 2, re: /\b(?:[1-9]\d{1,2})\+?\s+(?:legendary |free |mind[- ]?blowing |powerful |insane |hidden |underrated |ai |must[- ]have |best )*(?:websites?|ai tools|tools|prompts|github repos|repos|courses|books|resources|chrome extensions|apps|places to launch|rabbit holes|ai agents|ways to use|ways|tips|tricks|hacks|secrets|lessons|guides|setups|use cases|skills)\b/i },
  { id: 'free-course', label: 'Free course/roadmap bait', weight: 2, re: /\b(?:just (?:dropped|released|made)[^.\n]{0,40}(?:free|course|guide)|(?:free|full|complete) (?:\d+[- ]hour )?(?:ai |claude |chatgpt |gemini )?(?:course|masterclass|roadmap|tutorial)s?\b)/i },
  { id: 'never-public', label: '“Never supposed to be public”', weight: 3, re: /\b(?:never (?:supposed|meant) to (?:be|go) public|leaked (?:video|course|guide)|they don'?t want you to know)\b/i },

  // engagement bait
  { id: 'bookmark', label: '“Bookmark/save this”', weight: 2, re: /\b(?:bookmark|save) (?:this|it)(?: (?:now|for later|before))?\b|\bbookmark (?:it|this) and\b/i },
  { id: 'thank-me', label: '“You’ll thank me later”', weight: 2, re: /\byou'?ll thank me later\b/i },
  { id: 'need-to-read', label: '“You need to read this”', weight: 2, re: /\b(?:you|u) (?:need|have) to read this\b/i },
  { id: 'comment-dm', label: 'Comment-to-DM bait', weight: 3, re: /\b(?:comment|reply|type)\s+["“'‘]?[a-z0-9]{2,15}["”'’]?\s+(?:and|&|\+|below and)\s+(?:i'?ll|i will|ill|we'?ll)\s+(?:send|dm|share)/i },
  { id: 'follow-bait', label: 'Follow/like/RT bait', weight: 2, re: /\b(?:follow|like|retweet|rt)\s+(?:me\s+)?(?:\+|&|and)\s+(?:comment|reply|retweet|rt|like)\b/i },
  { id: 'thread-arrow', label: 'Thread arrow ending', weight: 1, re: /(?:👇|⬇️|🧵)\s*$/u, first: true },

  // money and agent fantasies
  { id: 'sleep-money', label: '“Went to sleep, it made money” story', weight: 2, re: /\b(?:went to sleep|while i slept|by morning|overnight)\b[^\n]{0,140}(?:\$\d|revenue|paying client|mrr|made me|profit)|\b(?:\$\d[\d,.]*k?)[^\n]{0,120}\b(?:while i slept|by morning|overnight)\b/i },
  { id: 'one-rule', label: '“Gave my AI one rule” story', weight: 2, re: /\b(?:gave|told) (?:it|my (?:ai|agent|bot)s?|(?:\w+ )?bots?)\b[^\n]{0,30}\bone (?:rule|goal|instruction|job)\b/i },
  { id: 'friend-makes', label: '“My friend makes $1M” hook', weight: 3, re: /\bmy (?:friend|buddy|cousin|neighbor) (?:makes|earns|made) \$[\d.,]+\s*(?:million|m|k)\b/i },
  { id: 'quit-job', label: 'Quit-your-job / passive income', weight: 1, re: /\b(?:quit your (?:9[-–]5|job)|passive income)\b/i },

  // fear bait
  { id: 'account-fear', label: '“If you have a Gmail account…” scare', weight: 3, re: /\bif you (?:have|use) (?:a |an )?(?:gmail|google|iphone|android|facebook|instagram|whatsapp|chatgpt|outlook) (?:account|phone)?,? (?:you need to|read this|don'?t skip)/i },
  { id: 'breaking-tech', label: '“🚨 BREAKING” on a how-to', weight: 2, re: /^\W*(?:🚨\s*)?breaking(?: news)?\W[^\n]{0,160}\b(?:gmail|chatgpt|claude|gemini|grok|ai|prompts?|free)\b/iu, first: true },
];

const TOPIC = /\b(?:ai|a\.i\.|claude|chatgpt|gpt|grok|gemini|openai|anthropic|llm|agents?|bots?|prompts?|automation|saas|startup|side hustle|passive income|\$\d[\d,.]*\s*(?:k|m|million|\/mo|per month|a month))\b/i;

/** Formatting tells that only count when combined with other signals. */
function formattingScore(text) {
  let s = 0;
  const lines = text.split('\n');
  const first = lines[0] || '';
  const letters = first.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 15 && letters === letters.toUpperCase()) s += 1; // ALL-CAPS opener
  const emojiBullets = lines.filter((l) => /^\s*(?:[\u{1F300}-\u{1FAFF}☀-➿]|\d+[.)]|[→✅•▪️👉])/u.test(l)).length;
  if (emojiBullets >= 6) s += 1;
  if (/[\u{1D400}-\u{1D7FF}]/u.test(text)) s += 1; // 𝗯𝗼𝗹𝗱 Unicode letters
  return s;
}

/** Score the AI-bait rules. Returns { score, hits: [{id, label, weight}] }. */
export function baitScore(text) {
  const t = String(text || '');
  const first = t.split('\n')[0] || '';
  const hits = [];
  for (const r of RULES) {
    if (r.re.test(r.first ? first : t)) hits.push({ id: r.id, label: r.label, weight: r.weight });
  }
  let score = hits.reduce((a, h) => a + h.weight, 0);
  if (hits.length) {
    const f = formattingScore(t);
    if (f) { score += f; hits.push({ id: 'formatting', label: 'Engagement-bait formatting', weight: f }); }
    // Farmed bait is overwhelmingly about AI, tools or money. Hype words on a
    // sports clip or a recipe shouldn't cross the default threshold alone.
    if (TOPIC.test(t)) { score += 1; hits.push({ id: 'topic', label: 'AI/money topic', weight: 1 }); }
  }
  return { score, hits };
}

export const SENSITIVITY = {
  gentle: { bait: 7, label: 'Gentle' },
  balanced: { bait: 5, label: 'Balanced' },
  strict: { bait: 3, label: 'Strict' },
};

/**
 * Classify one post.
 * @param {object} post {text, author}
 * @param {object} ctx  {listIndex, farms:Set, seen:Index, sensitivity, enabled:{copypasta,farms,bait}}
 * @returns {{verdict:'hide'|'ok', reasons:Array, sig}}
 */
export function classify(post, ctx = {}) {
  const enabled = { copypasta: true, farms: true, bait: true, ...(ctx.enabled || {}) };
  const reasons = [];
  const author = String(post.author || '').toLowerCase();
  const sig = signature(post.text);

  if (enabled.farms && ctx.farms && author && ctx.farms.has(author)) {
    const f = ctx.farmInfo?.get?.(author);
    reasons.push({ kind: 'farm', label: `Account seen copy-pasting ${f?.copies ?? 'farmed'} posts`, weight: 10 });
  }
  if (enabled.copypasta && sig) {
    const m = ctx.listIndex?.query(sig, 0.5);
    if (m) reasons.push({ kind: 'copypasta', label: `Same post by ${m.data.accounts} accounts`, weight: 10, cluster: m.data });
    else if (ctx.seen) {
      const local = ctx.seen.queryAll(sig, 0.6).filter((x) => x.data.author !== author);
      if (local.length) {
        const others = [...new Set(local.map((x) => x.data.author))];
        reasons.push({ kind: 'copypasta-local', label: `Same post by @${others.slice(0, 2).join(', @')} in your feed`, weight: 8, others });
      }
    }
  }
  const sens = SENSITIVITY[ctx.sensitivity] || SENSITIVITY.balanced;
  let bait = null;
  if (enabled.bait) {
    bait = baitScore(post.text);
    if (bait.score >= sens.bait) reasons.push({ kind: 'bait', label: bait.hits.filter((h) => h.id !== 'formatting').map((h) => h.label).slice(0, 2).join(' · '), weight: bait.score, hits: bait.hits });
  }
  return { verdict: reasons.length ? 'hide' : 'ok', reasons, sig, bait };
}

/** Build an Index from a published fingerprint list. */
export function indexFromList(list) {
  const idx = new Index();
  for (const c of list?.clusters || []) {
    if (!c.sig) continue;
    idx.add(hexToSig(c.sig), { id: c.id, accounts: c.accounts, posts: c.posts, sample: c.sample, example: c.example });
  }
  return idx;
}
