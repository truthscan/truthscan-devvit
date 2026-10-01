# TruthScan AI Detector — Devvit app

A Reddit **Developer Platform (Devvit)** app that adds a post menu action
**"Check if AI (TruthScan)"**. When a moderator triggers it on an image post, the
app sends that post's image to TruthScan's detector and replies **in-thread** with
a verdict (likely AI-generated vs. likely real) and a confidence score. Operated by
**Undetectable AI** (https://truthscan.com).

## HTTP fetch domains (for Reddit app review)
This app makes **one** outbound `fetch`, to a single domain we own and operate:

- **`detect-url.truthscans.com`** — TruthScan's detect-by-URL service (a Cloudflare
  Worker we run). It receives the **public image URL** of the post the user asked
  about, runs AI-image detection, and returns a verdict.

Details relevant to review:
- **No user data leaves the platform.** Only the public image URL of the post is
  sent; the result is posted back as an **in-thread comment** — users are never
  redirected or sent off-platform.
- **No PII, no scraping, no storage of Reddit data.** The service processes the one
  image and returns a score.
- **Privacy Policy:** https://truthscan.com/privacy
- **Terms of Service:** https://truthscan.com/terms
- The domain is a **company-owned** service (not a personal/throwaway host).

## Trade-offs
- **Mod-install only.** A Devvit app runs only in subreddits whose moderators
  install it (not globally summonable — that was the rejected Data API bot's model).
- **Domain approval.** Devvit sandboxes `fetch()` to Reddit-approved domains. The
  exception for `detect-url.truthscans.com` is auto-submitted on publish and
  reviewed by Reddit (~1–2 business days). Until approved, the fetch returns
  "domain … is not allowed."

## Setup
```bash
cd truthscan-devvit
npm install                       # installs devvit CLI + public-api locally
npx devvit login                  # Reddit auth (browser)
npx devvit settings set truthscanApiKey   # app secret
npx devvit playtest r/<a_sub_you_moderate>
```
Open an image post → "..." menu → **Check if AI (TruthScan)**.

Ship it:
```bash
npx devvit upload      # private build
npx devvit publish     # submit for review (also submits the fetch-domain exception)
```

## How it works
`src/main.tsx`:
- `Devvit.addSettings` — the TruthScan API key (app-level secret).
- `Devvit.configure({ http: { domains: ['detect-url.truthscans.com'] } })` — fetch allowlist.
- `Devvit.addMenuItem({ location: 'post' })` — the "Check if AI" action: resolve the
  post image → `POST detect-url.truthscans.com` → post the verdict as a comment.

The Worker (`truthscan-detect-url-worker`) does the heavy lifting: download the
image → presign/upload → `/detect` → poll `/query` against `detect-image.truthscan.com`,
returning the result. So Devvit only ever touches the one allowlisted host.

## Status / TODO
- [x] Single branded fetch host (`detect-url.truthscans.com`).
- [x] Published unlisted (v0.0.4); domain exception pending Reddit review.
- [ ] Handle galleries / crossposts in `imageUrlFromPost`.
- [ ] Optional: text posts via a text detect-by-URL path.
- [ ] If the domain exception is refused, fall back to the TruthScan Chrome extension
      (checks Reddit images with no Reddit-platform dependency).
