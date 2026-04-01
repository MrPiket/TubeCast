import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import * as yt from '../youtube';
import config from '../config';
import { Subscription, YtDlpVideo } from '../types';

export function start(): void {
  const cronExpr = `*/${config.POLL_INTERVAL_MINUTES} * * * *`;

  console.log(`[scheduler] Polling every ${config.POLL_INTERVAL_MINUTES} minutes`);

  cron.schedule(cronExpr, async () => {
    console.log(`[scheduler] Starting poll at ${new Date().toISOString()}`);

    const subs = db.getAllSubscriptions();

    for (const sub of subs) {
      try {
        await pollSubscription(sub);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${new Date().toISOString()}] [scheduler] Error polling ${sub.id} (${sub.title}):`, message);
      }
    }

    console.log(`[scheduler] Poll complete at ${new Date().toISOString()}`);
  });
}

async function pollSubscription(sub: Subscription): Promise<void> {
  if (sub.type === 'video') {
    return;
  }

  const resolvedUrl = yt.resolveUrl({ type: sub.type, youtubeId: sub.youtube_id });

  console.log(`[scheduler] Checking ${sub.type} "${sub.title}" (${sub.youtube_id})`);

  const entries = await yt.fetchMetadata(resolvedUrl, sub.type, 15);
  const now = Math.floor(Date.now() / 1000);
  let newCount = 0;

  for (const entry of entries) {
    const videoId = yt.extractVideoId(entry);
    if (!videoId) continue;

    if (db.episodeExists(videoId, sub.id)) continue;

    db.insertEpisode({
      id: uuidv4(),
      subscription_id: sub.id,
      video_id: videoId,
      title: entry.title || 'Untitled',
      description: (entry.description || '').slice(0, 2000),
      thumbnail: entry.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      published_at: entry.timestamp || (entry.upload_date ? parseDateToTimestamp(entry.upload_date) : now),
      duration_sec: entry.duration || null,
      is_live: yt.isLive(entry),
      is_short: yt.isShort(entry),
      created_at: now,
    });
    newCount++;
  }

  db.updateLastChecked(sub.id, now);

  if (newCount > 0) {
    console.log(`[scheduler] Found ${newCount} new episodes for "${sub.title}"`);
  }
}

function parseDateToTimestamp(dateStr: string): number | null {
  if (!dateStr) return null;
  if (/^\d{8}$/.test(dateStr)) {
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    return Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000);
  }
  const ts = Date.parse(dateStr);
  return isNaN(ts) ? null : Math.floor(ts / 1000);
}
