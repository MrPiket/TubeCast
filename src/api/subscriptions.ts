import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import * as yt from '../youtube';
import config from '../config';

const router = Router();

// POST /api/subscriptions
router.post('/', async (req: Request, res: Response) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const parsed = yt.parseYoutubeUrl(url);
    const resolvedUrl = yt.resolveUrl(parsed);

    console.log(`[subscriptions] Creating subscription for ${parsed.type}: ${parsed.youtubeId}`);

    const entries = await yt.fetchMetadata(resolvedUrl, parsed.type, config.INITIAL_EPISODES);

    if (!entries || entries.length === 0) {
      res.status(400).json({ error: 'No videos found at the given URL' });
      return;
    }

    const firstEntry = entries[0];
    let title: string;
    let description: string;
    let thumbnail: string;

    if (parsed.type === 'video') {
      title = firstEntry.title || 'Untitled Video';
      description = firstEntry.description || '';
      thumbnail = firstEntry.thumbnail || firstEntry.thumbnails?.[0]?.url || '';
    } else {
      title = firstEntry.playlist_title || firstEntry.channel || firstEntry.uploader || firstEntry.playlist || 'Untitled';
      description = firstEntry.description || firstEntry.playlist_description || '';
      thumbnail = firstEntry.channel_url
        ? `https://i.ytimg.com/vi/${yt.extractVideoId(firstEntry)}/hqdefault.jpg`
        : '';
    }

    const subId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.createSubscription({
      id: subId,
      type: parsed.type,
      youtube_id: parsed.youtubeId,
      title,
      description: (description || '').slice(0, 2000),
      thumbnail,
      original_url: url,
      created_at: now,
    });

    for (const entry of entries) {
      const videoId = yt.extractVideoId(entry);
      if (!videoId) continue;

      db.insertEpisode({
        id: uuidv4(),
        subscription_id: subId,
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
    }

    db.updateLastChecked(subId, now);

    const feedUrl = `${config.FEED_BASE_URL}/feed/${subId}.xml`;

    console.log(`[subscriptions] Created subscription ${subId} with ${entries.length} episodes`);

    res.status(201).json({
      id: subId,
      title,
      type: parsed.type,
      feedUrl,
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [subscriptions] Error creating subscription:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// GET /api/subscriptions
router.get('/', (_req: Request, res: Response) => {
  const subs = db.getAllSubscriptions();
  res.json(subs.map(s => ({
    ...s,
    feedUrl: `${config.FEED_BASE_URL}/feed/${s.id}.xml`,
  })));
});

// GET /api/subscriptions/:id
router.get('/:id', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  const episodes = db.getEpisodesBySubscription(sub.id);
  res.json({
    ...sub,
    feedUrl: `${config.FEED_BASE_URL}/feed/${sub.id}.xml`,
    episodes,
  });
});

// PATCH /api/subscriptions/:id/filters
router.patch('/:id/filters', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }

  const { filter_lives, filter_shorts, filter_min_duration, filter_max_duration } = req.body as {
    filter_lives?: boolean | number;
    filter_shorts?: boolean | number;
    filter_min_duration?: string | number;
    filter_max_duration?: string | number;
  };

  const filters: Record<string, number> = {};
  if (filter_lives !== undefined) filters.filter_lives = filter_lives ? 1 : 0;
  if (filter_shorts !== undefined) filters.filter_shorts = filter_shorts ? 1 : 0;
  if (filter_min_duration !== undefined) filters.filter_min_duration = parseInt(String(filter_min_duration), 10) || 0;
  if (filter_max_duration !== undefined) filters.filter_max_duration = parseInt(String(filter_max_duration), 10) || 0;

  db.updateFilters(sub.id, filters);
  const updated = db.getSubscription(sub.id);
  res.json(updated);
});

// POST /api/subscriptions/:id/load-more
const LOAD_MORE_BATCH = 10;
router.post('/:id/load-more', async (req: Request, res: Response) => {
  try {
    const sub = db.getSubscription(req.params.id as string);
    if (!sub) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    if (sub.type === 'video') {
      res.json({ newCount: 0, hasMore: false });
      return;
    }

    const currentCount = db.getEpisodesBySubscription(sub.id).length;
    const startEntry = currentCount + 1;

    const resolvedUrl = yt.resolveUrl({ type: sub.type, youtubeId: sub.youtube_id });
    const entries = await yt.fetchMetadata(resolvedUrl, sub.type, LOAD_MORE_BATCH, startEntry);
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

    const hasMore = entries.length === LOAD_MORE_BATCH;
    console.log(`[subscriptions] Load-more for "${sub.title}": ${newCount} new episodes (start=${startEntry}, hasMore=${hasMore})`);
    res.json({ newCount, hasMore });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [subscriptions] Error in load-more:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to load more episodes' });
  }
});

// DELETE /api/subscriptions/:id
router.delete('/:id', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).json({ error: 'Subscription not found' });
    return;
  }
  db.deleteSubscription(sub.id);
  res.json({ ok: true });
});

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

export default router;
