const Database = require('better-sqlite3');
const fs = require('fs');
const config = require('../config');
const { migrate } = require('./schema');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    db = new Database(config.DB_PATH);
    migrate(db);
  }
  return db;
}

// --- Subscriptions ---

function createSubscription(sub) {
  const stmt = getDb().prepare(`
    INSERT INTO subscriptions (id, type, youtube_id, title, description, thumbnail, original_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(sub.id, sub.type, sub.youtube_id, sub.title, sub.description, sub.thumbnail, sub.original_url, sub.created_at);
}

function getAllSubscriptions() {
  return getDb().prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all();
}

function getSubscription(id) {
  return getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

function deleteSubscription(id) {
  getDb().prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
}

function updateFilters(id, filters) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(filters)) {
    const allowed = ['filter_lives', 'filter_shorts', 'filter_min_duration', 'filter_max_duration'];
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function updateLastChecked(id, timestamp) {
  getDb().prepare('UPDATE subscriptions SET last_checked_at = ? WHERE id = ?').run(timestamp, id);
}

// --- Episodes ---

function insertEpisode(ep) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO episodes (id, subscription_id, video_id, title, description, thumbnail, published_at, duration_sec, is_live, is_short, download_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  stmt.run(ep.id, ep.subscription_id, ep.video_id, ep.title, ep.description, ep.thumbnail, ep.published_at, ep.duration_sec, ep.is_live ? 1 : 0, ep.is_short ? 1 : 0, ep.created_at);
}

function getEpisodesBySubscription(subscriptionId) {
  return getDb().prepare('SELECT * FROM episodes WHERE subscription_id = ? ORDER BY published_at DESC').all(subscriptionId);
}

function getFilteredEpisodes(subscription) {
  let conditions = ['subscription_id = ?'];
  let params = [subscription.id];

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
  return getDb().prepare(`SELECT * FROM episodes WHERE ${where} ORDER BY published_at DESC`).all(...params);
}

function episodeExists(videoId, subscriptionId) {
  const row = getDb().prepare('SELECT 1 FROM episodes WHERE video_id = ? AND subscription_id = ?').get(videoId, subscriptionId);
  return !!row;
}

function incrementDownloadCount(videoId) {
  getDb().prepare('UPDATE episodes SET download_count = download_count + 1 WHERE video_id = ?').run(videoId);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  createSubscription,
  getAllSubscriptions,
  getSubscription,
  deleteSubscription,
  updateFilters,
  updateLastChecked,
  insertEpisode,
  getEpisodesBySubscription,
  getFilteredEpisodes,
  episodeExists,
  incrementDownloadCount,
  closeDb,
};
