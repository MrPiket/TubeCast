import { Router, Request, Response } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import * as yt from '../youtube';
import config from '../config';
import { findCachedFile, clearVideoCache } from './audio';
import { Episode } from '../types';

const router = Router();

interface EpisodeWithCache extends Episode {
  cached: boolean;
  cacheSize: number;
}

// Home page
router.get('/', (_req: Request, res: Response) => {
  res.render('home', { result: null, error: null });
});

// Handle create form submission
router.post('/subscriptions/create', async (req: Request, res: Response) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.render('home', { result: null, error: 'Please enter a URL.' });
      return;
    }

    const parsed = yt.parseYoutubeUrl(url);
    const resolvedUrl = yt.resolveUrl(parsed);

    const entries = await yt.fetchMetadata(resolvedUrl, parsed.type, config.INITIAL_EPISODES);

    if (!entries || entries.length === 0) {
      res.render('home', { result: null, error: 'No videos found at the given URL.' });
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
      thumbnail = `https://i.ytimg.com/vi/${yt.extractVideoId(firstEntry)}/hqdefault.jpg`;
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
        published_at: entry.timestamp || parseDateToTimestamp(entry.upload_date) || now,
        duration_sec: entry.duration || null,
        is_live: yt.isLive(entry),
        is_short: yt.isShort(entry),
        created_at: now,
      });
    }

    db.updateLastChecked(subId, now);

    const feedUrl = `${config.FEED_BASE_URL}/feed/${subId}.xml`;
    res.render('home', { result: { title, feedUrl, id: subId }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toISOString()}] [views] Error creating subscription:`, message);
    res.render('home', { result: null, error: message });
  }
});

// Subscriptions list
router.get('/subscriptions', (_req: Request, res: Response) => {
  const subs = db.getAllSubscriptions();
  const subscriptions = subs.map(s => ({
    ...s,
    feedUrl: `${config.FEED_BASE_URL}/feed/${s.id}.xml`,
  }));
  res.render('subscriptions', { subscriptions });
});

// Subscription detail
router.get('/subscriptions/:id', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).send('Subscription not found');
    return;
  }
  const episodes = db.getEpisodesBySubscription(sub.id);
  const feedUrl = `${config.FEED_BASE_URL}/feed/${sub.id}.xml`;

  const episodesWithCache: EpisodeWithCache[] = episodes.map(ep => {
    const cachedPath = findCachedFile(ep.video_id);
    let cacheSize = 0;
    if (cachedPath) {
      try { cacheSize = fs.statSync(cachedPath).size; } catch { /* ignore */ }
    }
    return { ...ep, cached: !!cachedPath, cacheSize };
  });

  const cachedCount = episodesWithCache.filter(e => e.cached).length;
  const cachedSize = episodesWithCache.reduce((sum, e) => sum + e.cacheSize, 0);

  res.render('subscription-detail', {
    subscription: sub, episodes: episodesWithCache, feedUrl, cachedCount, cachedSize,
  });
});

// Handle filter update
router.post('/subscriptions/:id/filters', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).send('Subscription not found');
    return;
  }

  const filters = {
    filter_lives: req.body.filter_lives ? 1 as const : 0 as const,
    filter_shorts: req.body.filter_shorts ? 1 as const : 0 as const,
    filter_min_duration: parseInt(req.body.filter_min_duration, 10) || 0,
    filter_max_duration: parseInt(req.body.filter_max_duration, 10) || 0,
  };

  db.updateFilters(sub.id, filters);
  res.redirect(`/subscriptions/${sub.id}`);
});

// Clear cache for a single episode
router.post('/subscriptions/:id/clear-cache/:videoId', (req: Request, res: Response) => {
  clearVideoCache(req.params.videoId as string);
  res.redirect(`/subscriptions/${req.params.id as string}`);
});

// Clear all cache for a subscription's episodes
router.post('/subscriptions/:id/clear-all-cache', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (sub) {
    const episodes = db.getEpisodesBySubscription(sub.id);
    for (const ep of episodes) {
      clearVideoCache(ep.video_id);
    }
  }
  res.redirect(`/subscriptions/${req.params.id as string}`);
});

// Handle delete
router.post('/subscriptions/:id/delete', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (sub) {
    db.deleteSubscription(sub.id);
  }
  res.redirect('/subscriptions');
});

function parseDateToTimestamp(dateStr: string | undefined): number | null {
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
