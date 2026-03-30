const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const yt = require('../youtube');
const config = require('../config');

const router = Router();

// POST /api/subscriptions — Create a new subscription
router.post('/', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const parsed = yt.parseYoutubeUrl(url);
    const resolvedUrl = yt.resolveUrl(parsed);

    console.log(`[subscriptions] Creating subscription for ${parsed.type}: ${parsed.youtubeId}`);

    // Fetch entries using yt-dlp
    const entries = await yt.fetchMetadata(resolvedUrl, parsed.type, config.INITIAL_EPISODES);

    if (!entries || entries.length === 0) {
      return res.status(400).json({ error: 'No videos found at the given URL' });
    }

    // Derive container metadata from entries
    const firstEntry = entries[0];
    let title, description, thumbnail;

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
      description: description?.slice(0, 2000) || '',
      thumbnail,
      original_url: url,
      created_at: now,
    });

    // Insert episodes
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
        published_at: entry.timestamp || entry.upload_date ? parseDateToTimestamp(entry.upload_date) : now,
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
    console.error(`[${new Date().toISOString()}] [subscriptions] Error creating subscription:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/subscriptions — List all subscriptions
router.get('/', (req, res) => {
  const subs = db.getAllSubscriptions();
  res.json(subs.map(s => ({
    ...s,
    feedUrl: `${config.FEED_BASE_URL}/feed/${s.id}.xml`,
  })));
});

// GET /api/subscriptions/:id — Get subscription detail with episodes
router.get('/:id', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  const episodes = db.getEpisodesBySubscription(sub.id);
  res.json({
    ...sub,
    feedUrl: `${config.FEED_BASE_URL}/feed/${sub.id}.xml`,
    episodes,
  });
});

// PATCH /api/subscriptions/:id/filters — Update filters
router.patch('/:id/filters', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  const { filter_lives, filter_shorts, filter_min_duration, filter_max_duration } = req.body;
  const filters = {};
  if (filter_lives !== undefined) filters.filter_lives = filter_lives ? 1 : 0;
  if (filter_shorts !== undefined) filters.filter_shorts = filter_shorts ? 1 : 0;
  if (filter_min_duration !== undefined) filters.filter_min_duration = parseInt(filter_min_duration, 10) || 0;
  if (filter_max_duration !== undefined) filters.filter_max_duration = parseInt(filter_max_duration, 10) || 0;

  db.updateFilters(sub.id, filters);
  const updated = db.getSubscription(sub.id);
  res.json(updated);
});

// DELETE /api/subscriptions/:id — Delete subscription
router.delete('/:id', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  db.deleteSubscription(sub.id);
  res.json({ ok: true });
});

function parseDateToTimestamp(dateStr) {
  if (!dateStr) return null;
  // yt-dlp returns dates as YYYYMMDD
  if (/^\d{8}$/.test(dateStr)) {
    const y = dateStr.slice(0, 4);
    const m = dateStr.slice(4, 6);
    const d = dateStr.slice(6, 8);
    return Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000);
  }
  const ts = Date.parse(dateStr);
  return isNaN(ts) ? null : Math.floor(ts / 1000);
}

module.exports = router;
