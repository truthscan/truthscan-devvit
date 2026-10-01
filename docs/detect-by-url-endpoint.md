# Spec: "Detect image by public URL" endpoint

**Owner:** TruthScan backend (image API)
**Consumer:** the Devvit app in this repo (and any client that has an image URL, not bytes)
**Status:** proposed

## Why
Today, detecting an image is a 4-step client dance: `get-presigned-url` → `PUT` to
DigitalOcean Spaces → `POST /detect` → poll `POST /query`. That forces a client to
reach **three** hosts (`detect-image.truthscan.com`, the DO Spaces storage host,
and the image host e.g. `i.redd.it`).

Devvit (Reddit's platform) sandboxes `fetch()` to a Reddit-approved **domain
allowlist**, and self-hosted/storage domains are the ones most likely to be
refused. This endpoint collapses the flow to **one call to one domain**: the
client sends a public image URL, the server does the download + full detection
pipeline internally and returns the verdict.

Benefit beyond Devvit: simpler integration for everyone, and the storage/upload
mechanics stay server-side.

## Endpoint
```
POST https://detect-image.truthscan.com/detect-url
Content-Type: application/json
```
(Route name is a suggestion; match your conventions.)

### Auth
Match the existing image API. Accept the API key via **either**:
- header `apikey: <KEY>` (as `get-presigned-url` / `check-user-credits` do), or
- body `"key": "<KEY>"` (as `/detect` / `/query` do).

Prefer header for this endpoint; accept both.

### Request body
```jsonc
{
  "key": "YOUR_API_KEY",              // or send via apikey header
  "url": "https://i.redd.it/abc.jpg", // REQUIRED — public image URL to analyze
  "wait": true,                        // optional (default true): block until result ready
  "max_wait_seconds": 30,              // optional: server-side poll cap (default ~30)
  "generate_analysis_details": false,  // optional, default false
  "generate_heatmap": false,           // optional, default false
  "generate_preview": false,           // optional, default false
  "model": "generic"                   // optional
}
```

### Server behavior
1. **Auth** — validate the API key (`403` if invalid). Credits: same as `/detect`
   (1 credit per image; same per-minute budget — counts as one "write").
2. **Validate `url`** — required; `https` (allow `http`→upgrade or reject per policy).
   `400` if missing/malformed.
3. **Download the image** with strict guards:
   - **SSRF protection (required):** resolve the host and **block private/internal
     targets** — RFC-1918 ranges, loopback/localhost, link-local, and the cloud
     metadata IP `169.254.169.254`. Follow redirects with a small cap and
     **re-validate every hop**. Only fetch public hosts.
   - Enforce **max size 10 MB** (same as upload) and the supported formats
     (JPG/JPEG/PNG/WebP/HEIC/HEIF/AVIF/BMP/TIFF/GIF/SVG/PDF). Reject oversized/
     unsupported/unreachable with `400`.
   - ~10s download timeout.
   - Determine content type from the bytes (magic number) or response
     `Content-Type` / URL extension.
4. **Run the existing pipeline internally** — reuse the current presign → upload →
   `/detect` → poll `/query` logic (no new detection code; this is a thin wrapper).
5. **Return:**
   - `wait: true` (default): block until the detection `status` is terminal (or
     `max_wait_seconds`), then return the final result synchronously.
   - `wait: false`: return `{ "id": "...", "status": "pending" }` and let the
     caller poll the existing `POST /query` with that `id`.

### Success response (`wait: true`, `200`)
Return the **same shape as `/query`** (the raw detection body) so clients get all
fields, including any added later:
```jsonc
{
  "id": "57258831-...",
  "status": "done",
  "result": 73.57,                 // 0-100 AI score
  "final_result": "AI Generated",  // or "Real"
  "final_label_confidence": 90,
  "result_details": { /* ... */ },
  "preview_url": "...",            // when generate_preview
  "heatmap_url": "...",            // when generate_heatmap
  "analysis_results": { /* ... */ } // when generate_analysis_details
}
```

### Errors (JSON `{ "error": "..." }`, mirror existing API)
| Status | When |
|---|---|
| 400 | missing/invalid `url`, unsupported/oversized file, download failed, SSRF-blocked host |
| 403 | invalid API key |
| 402 / 429 | no credits / rate limited (reuse existing semantics) |
| 504 | detection exceeded `max_wait_seconds` — optionally return `{id, status:"pending"}` so the caller can poll `/query` |
| 500 | server error |

## Effort
Small — it wraps the existing detection pipeline; the only genuinely new code is
the **guarded image download** (SSRF + size/type checks) in front of it.

## Devvit client change once shipped
In `src/main.tsx`, the whole `detectImage()` (presign/upload/poll) collapses to:
```ts
const res = await fetch('https://detect-image.truthscan.com/detect-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: apiKey, url: imageUrl }),
});
const q = await res.json(); // same shape as /query
```
Then **drop** `STORAGE_BASE`, the upload steps, **and** the `i.redd.it` fetch —
the server downloads the image. The Devvit app's only external host becomes
`detect-image.truthscan.com` (one domain to allowlist).
