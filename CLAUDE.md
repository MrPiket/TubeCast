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
- The scheduler proactively downloads audio for the 5 most recent filtered episodes per subscription; older cached files beyond the top 5 are evicted automatically
- Audio for episodes outside the top 5 is still available on-demand via `/audio/:videoId.mp3`
- The `yt-dlp` process is spawned directly (not via a library) in both `youtube/` (metadata) and `api/audio.ts` (download)

## Docker

- **Image:** `mrpiket/tubecast` on Docker Hub
- **Build:** `docker buildx build --platform linux/amd64 -t mrpiket/tubecast:latest .`
- **Push:** `docker push mrpiket/tubecast:latest`
- **Important:** Always build with `--platform linux/amd64` — the production server runs amd64 and ARM images will fail with `exec format error`
- **Run with compose:** `docker compose up` (maps port 5151, mounts `./data` for persistence)
- The Dockerfile installs `yt-dlp` and `ffmpeg` inside the image so no host dependencies are needed
- `docker-compose.yml` sets `DATA_DIR=/data`, `PORT=5151`, and `FEED_BASE_URL=http://localhost:5151`

## Deploy workflow

1. Make changes on a feature branch
2. Update `README.md` to reflect any user-facing changes (new features, config, API endpoints, etc.)
3. Create PR and merge to `main`
4. Build and push Docker image: `docker buildx build --platform linux/amd64 -t mrpiket/tubecast:latest --push .`

**Important:** The README must always be kept up to date. Any change that affects features, configuration, API, or project structure should include a corresponding README update in the same PR.
