const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE subscriptions (
        id              TEXT PRIMARY KEY,
        type            TEXT NOT NULL,
        youtube_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        thumbnail       TEXT,
        original_url    TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        last_checked_at INTEGER,
        filter_lives        INTEGER DEFAULT 1,
        filter_shorts       INTEGER DEFAULT 0,
        filter_min_duration INTEGER DEFAULT 0,
        filter_max_duration INTEGER DEFAULT 0
      );

      CREATE TABLE episodes (
        id              TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        video_id        TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        thumbnail       TEXT,
        published_at    INTEGER,
        duration_sec    INTEGER,
        is_live         INTEGER DEFAULT 0,
        is_short        INTEGER DEFAULT 0,
        download_count  INTEGER DEFAULT 0,
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX idx_episodes_subscription ON episodes(subscription_id);
      CREATE UNIQUE INDEX idx_episodes_video ON episodes(video_id, subscription_id);
    `,
  },
];

function migrate(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const currentVersion = row?.v || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
      console.log(`[db] Applied migration v${migration.version}`);
    }
  }
}

module.exports = { migrate };
