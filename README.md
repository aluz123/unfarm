<p align="center"><img src="assets/icon-256.png" width="96" alt=""></p>

# Unfarm: clean your X feed

**[aluz123.github.io/unfarm](https://aluz123.github.io/unfarm/)**

AI slop on X isn't random. The same posts get copy-pasted by dozens of accounts. In one week of viral posts we found a single "Gmail is reading your email" scare posted by **23 different accounts**. Unfarm is a browser extension that catches those copies, the accounts that farm them, and templated AI engagement bait. It hides them and shows you the receipts.

- **Copy-paste fingerprints.** A daily crawl samples thousands of viral posts and groups near-identical text posted by different accounts. If a post in your feed matches, it's hidden, with a link to every account that posted it.
- **Farm accounts.** Accounts caught copy-pasting repeatedly are listed with their receipts, and their other posts are hidden too.
- **AI bait rules.** Templates like "This is f*cking insane", "50 websites that feel illegal to know", "instead of Netflix tonight" and comment-to-DM bait. You pick gentle, balanced or strict.
- **Copies in your own feed.** Two accounts you scroll past posting the same thing? The second one is hidden.
- **Your daily slop score.** See how much of your feed was slop, and share it.

No API key, no account, no AI calls. Nothing you read leaves your browser: the extension downloads two public JSON lists a few times a day and does everything locally.

## Install (Chrome, Edge, Brave, Arc)

The Chrome Web Store listing is in review. Until then:

1. Download [`unfarm-extension.zip`](https://github.com/aluz123/unfarm/releases/latest/download/unfarm-extension.zip) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the folder.
3. Scroll x.com. Click the Unfarm icon to see today's numbers.

## How the list is built

`crawler/crawl.py` samples viral posts through X search. `scripts/build-lists.mjs` fingerprints the opening 40 words of each post with 64-hash MinHash (word 3-shingles). It then groups posts from different accounts whose fingerprints agree at least 50% (about 50% word overlap) and publishes:

- [`data/fingerprints.json`](data/fingerprints.json): copy-paste clusters with signatures, sample text, accounts and example links
- [`data/farms.json`](data/farms.json): accounts in 2+ clusters or with 3+ copied posts
- [`data/stats.json`](data/stats.json): crawl stats

Only the opening is fingerprinted because X truncates long posts in the timeline. The extension, the website and the list builder all import the same engine, [`extension/src/engine.js`](extension/src/engine.js).

The lists are public, so anyone can use them in their own tools.

## Development

```bash
node --test tests/*.test.js                 # engine tests on real posts
node scripts/e2e-live.mjs https://x.com/someaccount shot.png   # load the extension in Chrome and run it on live X
python3 crawler/crawl.py                    # needs the treg CLI
node scripts/build-lists.mjs crawler/raw/posts.json
./scripts/build-extension.sh                # bundles the lists and zips the extension
```

X's 2026 web app no longer ships `data-testid` attributes, so Unfarm reads posts from plain markup. It uses `<article>` for each post, the avatar's `alt="@handle"` for the author, the post's `div[dir=auto]` for the text, and `a[href*="/status/"]` for the link.

## Roadmap: Unfarm Pro

- AI image and video farm detection (the same generated clip reposted by many accounts)
- Copycat alerts for creators: get told when a farm reposts your post word for word
- LinkedIn and Threads
- Hourly list updates

## Wrongly listed?

[Open an issue](https://github.com/aluz123/unfarm/issues/new?title=Remove%20account%20from%20list) with a link and the account comes off the list. Clusters always need at least two different accounts posting the same text.

## License

MIT. Not affiliated with X Corp.
