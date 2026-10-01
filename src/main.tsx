/**
 * TruthScan AI Detector — Reddit Developer Platform (Devvit) app.
 *
 * Pivot from the account-bot (truthscan-reddit-bot), which Reddit's Data API
 * "Responsible Builder" review rejected. Devvit apps run on Reddit's own
 * platform: no Data API approval and no commercial contract. Trade-off: the app
 * only runs in subreddits whose MODERATORS install it.
 *
 * UX: adds a post menu action "Check if AI (TruthScan)". Triggered on an image
 * post, it sends the post's image URL to the TruthScan detect-by-URL Worker,
 * which downloads the image and runs detection server-side, then replies with a
 * verdict + score.
 *
 * Single allowlisted host: the Worker below. (The Worker does the download +
 * presign + upload + detect + poll, so Devvit never touches the storage host or
 * i.redd.it directly.)
 *
 * NOTE: API shapes target @devvit/public-api ~0.11. Verify against your
 * installed devvit version (`devvit --version`) and the current docs.
 */

import { Devvit, SettingScope } from '@devvit/public-api';

// TruthScan "detect image by public URL" Cloudflare Worker (truthscan-detect-url-worker).
// Swap for a branded domain (e.g. https://detect-url.truthscan.com) once the route is set up.
const DETECT_URL = 'https://truthscan-detect-url.bjuhasz08.workers.dev';

// The Worker host must be allowlisted here for fetch() to work in the sandbox.
Devvit.configure({
  redditAPI: true,
  http: { domains: ['truthscan-detect-url.bjuhasz08.workers.dev'] },
});

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
      // One call, one host: the Worker downloads the image and runs detection.
      const res = await fetch(DETECT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, key: apiKey }),
      });
      const q = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        ui.showToast(`TruthScan: ${(q.error as string) ?? res.status}`);
        return;
      }
      await reddit.submitComment({ id: postId, text: formatReply(q) });
      ui.showToast('Posted TruthScan result.');
    } catch (err) {
      console.error('TruthScan check failed:', err);
      ui.showToast('TruthScan check failed — see app logs.');
    }
  },
});

export default Devvit;
