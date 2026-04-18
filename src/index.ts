import path from 'path';
import express from 'express';
import config from './config';

const app = express();

const ROOT_DIR = path.resolve(__dirname, '..');

// Template engine
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT_DIR, 'src', 'views'));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(ROOT_DIR, 'public')));

// API routes
import subscriptionsRouter from './api/subscriptions';
app.use('/api/subscriptions', subscriptionsRouter);

// RSS feed
import feedRouter from './api/feed';
app.use('/feed', feedRouter);

// Audio streaming
import { router as audioRouter } from './api/audio';
app.use('/audio', audioRouter);

// Web views (must be last)
import viewsRouter from './api/views';
app.use('/', viewsRouter);

// Initialize database on startup
import { getDb } from './db';
getDb();

// Poll API endpoint
import { start as startScheduler, forcePoll, pollSingle } from './scheduler';
app.post('/api/poll', async (_req, res) => {
  try {
    await forcePoll();
    res.json({ ok: true });
  } catch (err) {
    console.error('[poll] Force poll failed:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Poll failed' });
  }
});
app.post('/api/subscriptions/:id/poll', async (req, res) => {
  try {
    await pollSingle(req.params.id as string);
    res.json({ ok: true });
  } catch (err) {
    console.error('[poll] Single poll failed:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Poll failed' });
  }
});

// Start scheduler
startScheduler();

app.listen(config.PORT, () => {
  console.log(`[tubecast] Server running on port ${config.PORT}`);
  console.log(`[tubecast] Feed base URL: ${config.FEED_BASE_URL}`);
});
