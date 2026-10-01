# TruthScan AI Detector — Devvit app

A Reddit **Developer Platform (Devvit)** app that adds a post menu action
**"Check if AI (TruthScan)"**. Triggered on an image post, it runs the image
through TruthScan's detector and replies in-thread with a verdict + score.

**Why this exists:** the account-bot route (`truthscan-reddit-bot`, u/truthscanAI)
was **rejected** by Reddit's Data API "Responsible Builder" review (ticket
#18487031, 2026-09-21). Devvit runs on Reddit's own platform — **no Data API
approval and no commercial contract** — so it sidesteps that wall.

## Trade-offs (know these going in)
- **Mod-install only.** A Devvit app runs only in subreddits whose *moderators*
  install it. It is NOT globally summonable by any user in any subreddit (that's
  what the rejected Data API bot would have done).
- **Domain allowlist.** Devvit sandboxes `fetch()` to approved domains. This app
  now calls a **single host** — the TruthScan detect-by-URL Cloudflare Worker
  (`truthscan-detect-url.bjuhasz08.workers.dev`, repo `truthscan-detect-url-worker`).
  The Worker downloads the image and runs detection server-side, so Devvit never
  touches the storage host or `i.redd.it` directly. Allowlist just that one host
  (swap for a branded `detect-url.truthscan.com` once the route is set up).

## Setup
```bash
cd truthscan-devvit
npm install
npm i -g devvit            # or: npm i -g devvit@latest
devvit login               # opens Reddit auth in your browser (I can't do this for you)
```

Set the API key (app-level secret):
```bash
devvit settings set truthscanApiKey
```

Test in a subreddit you moderate:
```bash
devvit playtest r/<your_test_subreddit>
```
Open a post there → "..." menu → **Check if AI (TruthScan)**.

Ship it:
```bash
devvit upload      # private build
devvit publish     # submit for App Directory review (needs a real README + meets Devvit rules)
```

## How it works
`src/main.tsx`:
- `Devvit.addSettings` — the TruthScan API key (secret).
- `Devvit.addMenuItem({ location: 'post' })` — the "Check if AI" action.
- `detectImage()` — presign → upload → `/detect` → poll `/query` (mirrors the
  TruthScan Make app). Swap for a single detect-by-URL call if/when that endpoint exists.
- `formatReply()` — the comment text (verdict + score + disclaimer).

## Status / TODO
- [ ] Confirm `@devvit/public-api` version and adjust any renamed APIs.
- [ ] Decide allowlist strategy: 3 domains vs. a detect-by-URL proxy (preferred).
- [ ] Handle galleries / crossposts in `imageUrlFromPost`.
- [ ] Consider a long poll via the scheduler if menu-handler timeouts bite.
- [ ] Optional: also support text posts via `detect-text.truthscan.com`.
- [ ] `devvit login` + `devvit upload` must be run by you (needs Reddit auth).
