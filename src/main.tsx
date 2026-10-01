/**
 * TruthScan AI Detector — Reddit Developer Platform (Devvit) app.
 *
 * Pivot from the account-bot (truthscan-reddit-bot), which Reddit's Data API
 * "Responsible Builder" review rejected. Devvit apps run on Reddit's own
 * platform: no Data API approval and no commercial contract. Trade-offs:
 *   - the app only runs in subreddits whose MODERATORS install it, and
 *   - server-side fetch() can only reach ALLOWLISTED domains (see README).
 *
 * UX: adds a post menu action "Check if AI (TruthScan)". Triggered on an image
 * post, it runs the image through TruthScan's image detector and replies with a
 * verdict + score.
 *
 * NOTE: API shapes below target @devvit/public-api ~0.11. Verify names against
 * your installed devvit version (`devvit --version`) and the current docs.
 */

import { Devvit, SettingScope } from '@devvit/public-api';

const IMAGE_BASE = 'https://detect-image.truthscan.com';
// Storage host the /detect step builds its object URL from (mirrors the Make app).
// RECOMMENDED: add a "detect by public image URL" endpoint on TruthScan so the
// Devvit app can POST the Reddit image URL and get a verdict in one call. That
// drops the allowlist to a single host and removes the client-side upload below.
const STORAGE_BASE = 'https://ai-image-detector-prod.nyc3.digitaloceanspaces.com';

Devvit.configure({ redditAPI: true, http: true });

Devvit.addSettings([
  {
    type: 'string',
    name: 'truthscanApiKey',
    label: 'TruthScan API key',
    scope: SettingScope.App,
    isSecret: true,
  },
]);

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.avif'];

function imageUrlFromPost(post: { url?: string }): string | null {
  const url = post.url ?? '';
  const lower = url.toLowerCase();
  if (
    IMAGE_EXTS.some((e) => lower.includes(e)) ||
    lower.includes('i.redd.it') ||
    lower.includes('i.imgur.com')
  ) {
    return url;
  }
  return null; // TODO: handle galleries (post.gallery) and crossposts
}

function contentTypeFor(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    avif: 'image/avif',
  };
  return map[ext] ?? 'image/jpeg';
}

/** Full presign -> upload -> detect -> poll flow (mirrors the TruthScan Make app). */
async function detectImage(imageUrl: string, apiKey: string): Promise<Record<string, unknown>> {
  // 1. download the image bytes from Reddit (requires i.redd.it allowlisted)
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
  const bytes = await imgRes.arrayBuffer();

  // 2. presigned upload URL
  const fileName = (imageUrl.split('?')[0].split('/').pop() || 'image.jpg').replace(/\s+/g, '_');
  const presignRes = await fetch(
    `${IMAGE_BASE}/get-presigned-url?file_name=${encodeURIComponent(fileName)}`,
    { headers: { apikey: apiKey } },
  );
  const presign = (await presignRes.json()) as { presigned_url?: string; file_path?: string };
  if (!presign.presigned_url || !presign.file_path) throw new Error('no presigned_url/file_path');

  // 3. upload the bytes
  const putRes = await fetch(presign.presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentTypeFor(fileName), 'x-amz-acl': 'private' },
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`upload failed: ${putRes.status}`);

  // 4. submit for detection
  const objectUrl = `${STORAGE_BASE}/${presign.file_path.replace(/^\//, '')}`;
  const detectRes = await fetch(`${IMAGE_BASE}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: apiKey,
      url: objectUrl,
      generate_heatmap: false,
      generate_analysis_details: false,
      generate_preview: false,
    }),
  });
  const detect = (await detectRes.json()) as { id?: string };
  if (!detect.id) throw new Error('no detect id');

  // 5. poll /query (bounded — menu handlers are short-lived)
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const qRes = await fetch(`${IMAGE_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: detect.id, key: apiKey }),
    });
    const q = (await qRes.json()) as Record<string, unknown>;
    if (q.result != null || q.final_result != null) return q;
  }
  throw new Error('timed out waiting for detection result');
}

function formatReply(q: Record<string, unknown>): string {
  const scoreNum = Number((q.result as number) ?? 0);
  const score = Math.round(scoreNum);
  const isAI = scoreNum >= 50;
  const head = isAI
    ? `🧠 **Likely AI-generated** — score ${score}/100.`
    : `📷 **Likely real (camera/human-made)** — score ${score}/100.`;
  return (
    `${head}\n\n` +
    `_AI detection is probabilistic — treat this as a signal, not proof._\n\n` +
    `^(🤖 TruthScan AI Detector · results from truthscan.com)`
  );
}

Devvit.addMenuItem({
  location: 'post',
  label: 'Check if AI (TruthScan)',
  onPress: async (event, context) => {
    const { reddit, ui, settings } = context;

    const apiKey = await settings.get<string>('truthscanApiKey');
    if (!apiKey) {
      ui.showToast('TruthScan API key is not configured (app settings).');
      return;
    }

    const postId = event.targetId ?? context.postId;
    if (!postId) {
      ui.showToast('Could not identify the post.');
      return;
    }

    const post = await reddit.getPostById(postId);
    const imageUrl = imageUrlFromPost(post);
    if (!imageUrl) {
      ui.showToast('No image found on this post to analyze.');
      return;
    }

    ui.showToast('Analyzing image with TruthScan…');
    try {
      const result = await detectImage(imageUrl, apiKey);
      await reddit.submitComment({ id: postId, text: formatReply(result) });
      ui.showToast('Posted TruthScan result.');
    } catch (err) {
      console.error('TruthScan check failed:', err);
      ui.showToast('TruthScan check failed — see app logs.');
    }
  },
});

export default Devvit;
