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

// Start scheduler
import { start as startScheduler } from './scheduler';
startScheduler();

app.listen(config.PORT, () => {
  console.log(`[tubecast] Server running on port ${config.PORT}`);
  console.log(`[tubecast] Feed base URL: ${config.FEED_BASE_URL}`);
});
