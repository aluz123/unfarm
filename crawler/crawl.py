"""Sample viral X posts for Unfarm's copy-paste list.

Uses the `treg` CLI (X search through treg's providers, about $0.0006 a call).
Writes crawler/raw/posts.json, merging with posts from the last 10 days so
copies posted a few days apart still land in the same cluster.

    python3 crawler/crawl.py            # ~200 calls, ~$0.12
"""
import concurrent.futures as cf
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "raw" / "posts.json"
KEEP_DAYS = 10
PAGES = 5

# Broad topics where engagement farms post. Farms copy across topics, so the
# list is intentionally wide rather than AI-only.
TOPICS = [
    "AI", "ChatGPT", "Claude", "Grok", "Gemini", "OpenAI", "Anthropic", "agent", "agents", "prompts",
    "Elon", "startup", "money", "income", "\"side hustle\"", "BREAKING", "insane", "\"you need to read this\"",
    "\"save this\"", "bookmark", "\"here's how\"", "\"nobody is talking about\"", "\"went to sleep\"", "free",
    "course", "Gmail", "Google", "Apple", "iPhone", "Tesla", "Meta", "Muse", "Seedance", "viral", "thread",
    "productivity", "SaaS", "marketing", "crypto", "learn", "websites", "tools", "\"feels illegal\"",
]


def search(q, cursor=None, since=None):
    body = {"query": f"{q} since:{since} lang:en min_faves:40 -filter:replies", "limit": 50, "queryType": "Top"}
    if cursor:
        body["cursor"] = cursor
    for _ in range(3):
        r = subprocess.run(["treg", "call", "anyapi.x.search.posts", "--method", "POST", "--data", json.dumps(body)],
                           capture_output=True, text=True, timeout=120)
        try:
            d = json.loads(r.stdout).get("output", {}).get("data", {})
            return d.get("items") or [], d.get("nextCursor")
        except Exception:
            time.sleep(2)
    return [], None


def topic(q, since):
    out, cur = [], None
    for _ in range(PAGES):
        items, cur = search(q, cur, since)
        out += items
        if not cur or not items:
            break
    return q, out


def main():
    since = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    posts = {}
    if OUT.exists():
        cutoff = time.time() - KEEP_DAYS * 86400
        for p in json.loads(OUT.read_text()):
            if p.get("createdUtc", 0) >= cutoff:
                posts[str(p["id"])] = p
    before = len(posts)
    with cf.ThreadPoolExecutor(8) as ex:
        for q, items in ex.map(lambda t: topic(t, since), TOPICS):
            print(f"{len(items):4d} {q}", file=sys.stderr)
            for it in items:
                keep = {k: it.get(k) for k in ("id", "text", "authorUsername", "createdUtc", "likeCount", "viewCount", "url")}
                posts[str(it["id"])] = keep
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(list(posts.values())))
    print(f"posts: {len(posts)} ({len(posts) - before} new)")


if __name__ == "__main__":
    main()
