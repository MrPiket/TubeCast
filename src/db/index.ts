import Database from 'better-sqlite3';
import fs from 'fs';
import config from '../config';
import { migrate } from './schema';
import { Subscription, Episode, CreateSubscriptionInput, CreateEpisodeInput, FilterInput } from '../types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    db = new Database(config.DB_PATH);
    migrate(db);
  }
  return db;
}

// --- Subscriptions ---

export function createSubscription(sub: CreateSubscriptionInput): void {
  const stmt = getDb().prepare(`
    INSERT INTO subscriptions (id, type, youtube_id, title, description, thumbnail, original_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(sub.id, sub.type, sub.youtube_id, sub.title, sub.description, sub.thumbnail, sub.original_url, sub.created_at);
}

export function getAllSubscriptions(): Subscription[] {
  return getDb().prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all() as Subscription[];
}

export function getSubscription(id: string): Subscription | undefined {
  return getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as Subscription | undefined;
}

export function deleteSubscription(id: string): void {
  getDb().prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
}

export function updateFilters(id: string, filters: FilterInput): void {
  const fields: string[] = [];
  const values: (number | string)[] = [];
  const allowed = ['filter_lives', 'filter_shorts', 'filter_min_duration', 'filter_max_duration'];

  for (const [key, val] of Object.entries(filters)) {
    if (allowed.includes(key) && val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function updateLastChecked(id: string, timestamp: number): void {
  getDb().prepare('UPDATE subscriptions SET last_checked_at = ? WHERE id = ?').run(timestamp, id);
}

// --- Episodes ---

export function insertEpisode(ep: CreateEpisodeInput): void {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO episodes (id, subscription_id, video_id, title, description, thumbnail, published_at, duration_sec, is_live, is_short, download_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  stmt.run(ep.id, ep.subscription_id, ep.video_id, ep.title, ep.description, ep.thumbnail, ep.published_at, ep.duration_sec, ep.is_live ? 1 : 0, ep.is_short ? 1 : 0, ep.created_at);
}

export function getEpisodesBySubscription(subscriptionId: string): Episode[] {
  return getDb().prepare('SELECT * FROM episodes WHERE subscription_id = ? ORDER BY published_at DESC').all(subscriptionId) as Episode[];
}

export function getFilteredEpisodes(subscription: Subscription): Episode[] {
  const conditions: string[] = ['subscription_id = ?'];
  const params: (string | number)[] = [subscription.id];

  if (!subscription.filter_lives) {
    conditions.push('is_live = 0');
  }
  if (!subscription.filter_shorts) {
    conditions.push('is_short = 0');
  }
  if (subscription.filter_min_duration > 0) {
    conditions.push('(duration_sec IS NULL OR duration_sec >= ?)');
    params.push(subscription.filter_min_duration);
  }
  if (subscription.filter_max_duration > 0) {
    conditions.push('(duration_sec IS NULL OR duration_sec <= ?)');
    params.push(subscription.filter_max_duration);
  }

  const where = conditions.join(' AND ');
  return getDb().prepare(`SELECT * FROM episodes WHERE ${where} ORDER BY published_at DESC`).all(...params) as Episode[];
}

export function episodeExists(videoId: string, subscriptionId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM episodes WHERE video_id = ? AND subscription_id = ?').get(videoId, subscriptionId);
  return !!row;
}

export function incrementDownloadCount(videoId: string): void {
  getDb().prepare('UPDATE episodes SET download_count = download_count + 1 WHERE video_id = ?').run(videoId);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
