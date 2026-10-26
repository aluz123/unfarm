import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../extension/src/engine.js';

const S = JSON.parse(readFileSync(new URL('./fixtures/samples.json', import.meta.url)));

test('normalize folds fancy Unicode, drops links, mentions and emoji', () => {
  assert.equal(E.normalize('𝗕𝗢𝗟𝗗 text 🚀 https://t.co/abc @someone #tag It’s ok!'), 'bold text its ok');
  assert.equal(E.normalize(''), '');
  assert.equal(E.normalize(null), '');
});

test('short posts get no fingerprint', () => {
  assert.equal(E.signature('too short to judge'), null);
  assert.ok(E.signature('one two three four five six seven eight nine ten eleven twelve'));
});

test('fingerprints are deterministic and round-trip through hex', () => {
  const t = S.pairs[0][0];
  const a = E.signature(t), b = E.signature(t);
  assert.deepEqual(a, b);
  assert.deepEqual(E.hexToSig(E.sigToHex(a)), a);
  assert.equal(E.similarity(a, b), 1);
});

test('copy-pasted variants from different accounts match', () => {
  for (const [a, b] of S.pairs) {
    const sim = E.similarity(E.signature(a), E.signature(b));
    assert.ok(sim >= 0.5, `expected a match (${sim.toFixed(2)}): ${a.slice(0, 60)}`);
  }
});

test('unrelated posts do not match each other', () => {
  const texts = [...S.normal, ...S.bait].filter((t) => E.signature(t));
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const sim = E.similarity(E.signature(texts[i]), E.signature(texts[j]));
    assert.ok(sim < 0.3, `unexpected match ${sim}: ${texts[i].slice(0, 40)} / ${texts[j].slice(0, 40)}`);
  }
});

test('timeline truncation still matches: only the opening is fingerprinted', () => {
  const full = S.pairs[0][0];
  const truncated = full.slice(0, 280);
  assert.ok(E.similarity(E.signature(full), E.signature(truncated)) >= 0.5);
});

test('LSH index finds near-duplicates and misses unrelated text', () => {
  const idx = new E.Index();
  S.pairs.forEach(([a], i) => idx.add(E.signature(a), { i }));
  S.pairs.forEach(([, b], i) => {
    const m = idx.query(E.signature(b), 0.5);
    assert.ok(m, `pair ${i} not found`);
    assert.equal(m.data.i, i);
  });
  for (const t of S.normal) {
    const sig = E.signature(t);
    if (sig) assert.equal(idx.query(sig, 0.5), null, t.slice(0, 50));
  }
});

test('engagement-bait posts score at or above the balanced threshold', () => {
  for (const t of S.bait) {
    const b = E.baitScore(t);
    assert.ok(b.score >= E.SENSITIVITY.balanced.bait, `score ${b.score} (${b.hits.map((h) => h.id)}) for: ${t.slice(0, 70)}`);
  }
});

test('ordinary posts stay under the balanced threshold', () => {
  for (const t of S.normal) {
    const b = E.baitScore(t);
    assert.ok(b.score < E.SENSITIVITY.balanced.bait, `false positive ${b.score} (${b.hits.map((h) => h.id)}): ${t.slice(0, 70)}`);
  }
});

test('specific bait rules fire on their templates', () => {
  const ids = (t) => E.baitScore(t).hits.map((h) => h.id);
  assert.ok(ids('THIS IS F*CKING INSANE. A dev just open-sourced a free ElevenLabs alternative').includes('hype-insane'));
  assert.ok(ids('THIS IS A REAL F*CKING GOLDMINE\n\nAnthropic shared a Claude Code trick').includes('hype-insane'));
  assert.ok(ids('50 websites that feel illegal to know:').includes('hype-illegal'));
  assert.ok(ids('50 websites that feel illegal to know:').includes('listicle'));
  assert.ok(ids('INSTEAD OF WATCHING NETFLIX TONIGHT. Spend 1 hour with this.').includes('netflix'));
  assert.ok(ids('Comment "AGENT" and I\'ll send you the full guide').includes('comment-dm'));
  assert.ok(ids('If you have a Gmail account, you need to read this.').includes('account-fear'));
  assert.ok(ids('My friend makes $1.2 million a year as an Anthropic engineer.').includes('friend-makes'));
  assert.ok(ids('Sam Altman (CEO of OpenAI):\n\n"You no longer need to write prompts."').includes('quote-bait'));
  assert.ok(ids('I gave my Grok bots one rule and went to sleep. By morning they made $4,000 in revenue').includes('sleep-money'));
});

test('hype words alone (sports, food) do not cross the default threshold', () => {
  const t = '🤯 THIS IS ABSOLUTELY INSANE! The fans are SO LOUD that the ref blew the whistle early.';
  assert.ok(E.baitScore(t).score < E.SENSITIVITY.balanced.bait);
});

test('classify: list match, farm account, local copy-paste, whitelist-free bait', () => {
  const listIdx = new E.Index();
  listIdx.add(E.signature(S.pairs[0][0]), { id: 'c1', accounts: 23 });
  const farms = new Set(['farmer123']);
  const seen = new E.Index();
  const normal = S.normal.find((t) => E.signature(t));

  const a = E.classify({ text: S.pairs[0][1], author: 'someone' }, { listIndex: listIdx, farms, seen });
  assert.equal(a.verdict, 'hide');
  assert.equal(a.reasons[0].kind, 'copypasta');
  assert.match(a.reasons[0].label, /23 accounts/);

  const b = E.classify({ text: normal, author: 'Farmer123' }, { listIndex: listIdx, farms, seen });
  assert.equal(b.verdict, 'hide');
  assert.ok(b.reasons.some((r) => r.kind === 'farm'));

  const c = E.classify({ text: normal, author: 'regular_person' }, { listIndex: listIdx, farms, seen });
  assert.equal(c.verdict, 'ok');

  // local detection: the same post by two different authors in one session
  const text = S.pairs[3][0];
  const first = E.classify({ text, author: 'alice' }, { listIndex: new E.Index(), farms, seen, enabled: { bait: false } });
  assert.equal(first.verdict, 'ok');
  seen.add(first.sig, { author: 'alice' });
  const again = E.classify({ text: S.pairs[3][1], author: 'bob' }, { listIndex: new E.Index(), farms, seen, enabled: { bait: false } });
  assert.equal(again.verdict, 'hide');
  assert.equal(again.reasons[0].kind, 'copypasta-local');
  // the same author reposting their own text is not copy-paste
  const self = E.classify({ text, author: 'alice' }, { listIndex: new E.Index(), farms, seen, enabled: { bait: false } });
  assert.equal(self.verdict, 'ok');
});

test('categories can be switched off', () => {
  const farms = new Set(['farmer123']);
  const r = E.classify({ text: S.normal[0], author: 'farmer123' }, { farms, enabled: { farms: false } });
  assert.equal(r.verdict, 'ok');
  const bait = E.classify({ text: S.bait[0], author: 'x' }, { enabled: { bait: false } });
  assert.equal(bait.verdict, 'ok');
});

test('sensitivity levels are ordered', () => {
  assert.ok(E.SENSITIVITY.strict.bait < E.SENSITIVITY.balanced.bait);
  assert.ok(E.SENSITIVITY.balanced.bait < E.SENSITIVITY.gentle.bait);
});
