# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TubeCast

TubeCast converts YouTube channels, playlists, and individual videos into podcast RSS feeds. It uses `yt-dlp` to fetch metadata and download audio on-demand, stores data in SQLite via `better-sqlite3`, and serves both a web UI (EJS templates) and a JSON API via Express 5.

## Prerequisites

- Node.js with npm
- `yt-dlp` installed and available on PATH (used for metadata fetching and audio download)
- `ffmpeg` on PATH (used by yt-dlp for audio conversion)

## Commands

- `npm run dev` — run in development with tsx (hot-reload, no build step)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output from `dist/index.js`
- No test suite is configured yet

## Configuration

All config is via environment variables (see `src/config.ts`):
- `PORT` (default 3000)
- `FEED_BASE_URL` (default `http://localhost:$PORT`) — base URL for generated feed/audio links
- `DATA_DIR` (default `./data`) — where SQLite DB and audio cache live
- `POLL_INTERVAL_MINUTES` (default 15) — how often the scheduler checks for new videos
- `INITIAL_EPISODES` (default 10) — how many videos to fetch when creating a subscription
- `AUDIO_CACHE_TTL_HOURS` (default 24) — cached mp3 files older than this are cleaned up

## Architecture

**Entry point:** `src/index.ts` — sets up Express, registers routes, initializes DB, starts the cron scheduler.

**Route layers (all under `src/api/`):**
- `subscriptions.ts` — JSON API (`/api/subscriptions`) for CRUD on subscriptions and episode filters
- `feed.ts` — serves RSS XML at `/feed/:id.xml`
- `audio.ts` — on-demand audio download and streaming at `/audio/:videoId.mp3`, with progress tracking and disk cache under `DATA_DIR/audio-cache/`
- `views.ts` — server-rendered web UI at `/`, `/subscriptions`, `/subscriptions/:id` (duplicates some subscription-creation logic from the API route)

**Core modules:**
- `youtube/` — URL parsing, yt-dlp metadata fetching, short/live detection helpers
- `rss/` — generates iTunes-compatible podcast RSS XML from subscription + episodes
- `scheduler/` — node-cron job that polls all non-video subscriptions for new episodes
- `db/` — SQLite access layer (singleton connection with WAL mode); `schema.ts` has a versioned migration system

**Data model:** Two main tables — `subscriptions` (channel/playlist/video with filter settings) and `episodes` (individual videos linked to a subscription). Filters (lives, shorts, duration range) are stored per-subscription and applied when generating the RSS feed.

**Views:** EJS templates in `src/views/` — `home.ejs` (create subscription), `subscriptions.ejs` (list), `subscription-detail.ejs` (episodes + filters + cache management). Static assets in `public/`.

## Key patterns

- Timestamps are stored as Unix epoch seconds (not milliseconds) throughout the codebase
- Boolean fields in SQLite use `0`/`1` integers; TypeScript types reflect this with `0 | 1`
- Audio files are downloaded on first request (not eagerly) and cached to disk; the cache is cleaned hourly
- The `yt-dlp` process is spawned directly (not via a library) in both `youtube/` (metadata) and `api/audio.ts` (download)
