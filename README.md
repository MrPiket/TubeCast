<p align="center">
  <img src="public/tubecast.png" alt="TubeCast" width="400">
</p>

<p align="center">
  <strong>Turn YouTube into a podcast.</strong><br>
  Channels, playlists, and videos — as RSS feeds in your favorite podcast app.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#features">Features</a> · <a href="#api">API</a> · <a href="#configuration">Configuration</a>
</p>

---

## How It Works

1. **Paste** a YouTube URL — channel, playlist, or single video
2. **TubeCast** fetches metadata and generates a podcast-compatible RSS feed
3. **Subscribe** in any podcast app (Apple Podcasts, Overcast, Pocket Casts, etc.)
4. **Listen** — the 5 most recent episodes are auto-downloaded and ready instantly

```
YouTube URL → TubeCast → RSS Feed → Your Podcast App
                  ↓                       ↓
           Auto-download top 5      Instant playback
```

## Features

- **Channels, Playlists & Single Videos** — supports any YouTube URL format including `@handles`, `/channel/`, `/c/`, `/user/`, and `youtu.be` short links
- **Proactive Downloads** — the 5 most recent episodes per subscription are automatically downloaded; older cached audio is evicted to save disk space
- **On-Demand Cache** — pre-cache any episode from the dashboard without downloading to your device; cache individual episodes or all at once
- **On-Demand Fallback** — older episodes are still available; audio is extracted via yt-dlp when requested
- **No Re-Encoding** — audio is saved as M4A by default and the AAC source is preferred when YouTube offers one, so yt-dlp copies the stream instead of running it through ffmpeg. Set `AUDIO_FORMAT=mp3` for the old behaviour at the cost of a full transcode per episode
- **Give Up On Dead Videos** — an episode YouTube has removed is retried a few times, then marked unavailable and dropped from the feed instead of being re-attempted on every poll forever
- **Atomic Downloads** — audio is staged outside the cache and moved in only once yt-dlp exits cleanly, so an interrupted download can never leave a truncated file that looks cached
- **Load More** — subscriptions start with 15 episodes; load more in batches of 10 from the subscription detail page until all episodes are fetched
- **Automatic Polling** — new episodes discovered on a configurable schedule; all feeds are refreshed on startup
- **Manual Poll** — force-refresh all subscriptions or a single one from the web dashboard
- **Auto-Updating yt-dlp** — yt-dlp updates itself on container start and daily at 4 AM to stay compatible with YouTube
- **Episode Filters** — filter out livestreams, shorts, or set min/max duration thresholds per subscription
- **iTunes-Compatible RSS** — proper `<itunes:*>` tags, artwork, and durations so feeds look great in any podcast app
- **Web Dashboard** — create feeds, manage subscriptions, and browse episodes
- **REST API** — full CRUD at `/api/subscriptions`
- **SQLite Storage** — lightweight, zero-config database with WAL mode and automatic migrations
- **Docker Ready** — single container with everything included

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
```

Open **http://localhost:5151** and paste a YouTube URL.

### Without Docker

Requires [Node.js](https://nodejs.org/) 22+, [ffmpeg](https://ffmpeg.org/), and [yt-dlp](https://github.com/yt-dlp/yt-dlp).

YouTube extraction now needs a JavaScript runtime. Node 22+ qualifies, but
yt-dlp only enables Deno by default — add `--js-runtimes node` to your
[yt-dlp config file](https://github.com/yt-dlp/yt-dlp/wiki/EJS) or some formats
will be silently unavailable. The Docker image does this for you.

```bash
# Install system dependencies (macOS)
brew install ffmpeg yt-dlp

# Install Node dependencies
npm install

# Build and run
npm run build
npm start

# Or run in development mode (no build step)
npm run dev
```

Open **http://localhost:3000**.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` | Directory for SQLite database |
| `FEED_BASE_URL` | `http://localhost:$PORT` | Public URL for RSS feed links (set to your domain in production) |
| `POLL_INTERVAL_MINUTES` | `15` | How often to check for new episodes |
| `INITIAL_EPISODES` | `15` | Episodes to fetch on first subscription |
| `AUDIO_CACHE_TTL_HOURS` | `24` | Cached audio files older than this are cleaned up |
| `AUDIO_FORMAT` | `m4a` | Audio format yt-dlp produces. `m4a` avoids re-encoding; `mp3`, `opus`, `aac`, `flac`, `wav` and `vorbis` are also accepted |
| `MAX_DOWNLOAD_ATTEMPTS` | `3` | Failed downloads after which an episode is marked unavailable |

> Changing `AUDIO_FORMAT` evicts cached files in the previous format on the next
> startup; they are re-downloaded on the following poll. Feed URLs published
> before the change keep working — the audio endpoint ignores the extension in
> the request and serves whatever is cached with its real MIME type.
>
> The source format is chosen to match the target (`bestaudio[ext=m4a]` for
> `m4a`), because YouTube's highest-bitrate audio is usually Opus and picking it
> would force a conversion anyway. When no matching source exists yt-dlp falls
> back to `bestaudio` and converts. The 128K quality setting therefore only
> applies on the conversion path — a copied stream keeps the source bitrate,
> typically 129 kbps AAC.

## API

### Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/subscriptions` | Create subscription (`{ "url": "..." }`) |
| `GET` | `/api/subscriptions` | List all subscriptions |
| `GET` | `/api/subscriptions/:id` | Get subscription with episodes |
| `PATCH` | `/api/subscriptions/:id/filters` | Update filters |
| `POST` | `/api/subscriptions/:id/poll` | Poll a single subscription for new episodes |
| `POST` | `/api/subscriptions/:id/load-more` | Fetch the next 10 episodes from the source |
| `DELETE` | `/api/subscriptions/:id` | Delete subscription |

### Feeds & Audio

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/feed/:id.xml` | RSS feed for a subscription |
| `GET` | `/audio/:videoId.:ext` | Stream audio for a video (the extension is ignored; the cached file's real format is served) |
| `GET` | `/audio/progress/:videoId` | Download progress |
| `POST` | `/audio/cache/:videoId` | Pre-cache audio without streaming |
| `GET` | `/audio/cache/info` | Cache stats (file count, total size) |
| `DELETE` | `/audio/cache` | Clear entire audio cache |
| `POST` | `/api/poll` | Force-poll all subscriptions and reset timer |
| `DELETE` | `/audio/cache/:videoId` | Clear cache for a single video |

## Project Structure

```
TubeCast/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── config.ts             # Environment configuration
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── api/
│   │   ├── views.ts          # Web UI routes
│   │   ├── subscriptions.ts  # REST API
│   │   ├── feed.ts           # RSS feed endpoint
│   │   └── audio.ts          # Audio streaming, caching & download
│   ├── db/
│   │   ├── index.ts          # Database access layer
│   │   └── schema.ts         # Versioned migrations
│   ├── rss/
│   │   └── index.ts          # RSS XML generation
│   ├── scheduler/
│   │   └── index.ts          # Cron polling + proactive downloads
│   ├── youtube/
│   │   └── index.ts          # yt-dlp wrapper & URL parsing
│   └── views/                # EJS templates
├── public/                   # Static assets
├── Dockerfile
└── docker-compose.yml
```

## Disclaimer

This project has been 100% vibe coded. It was built as a fun personal project to scratch my own itch. It comes with absolutely no warranty or guarantees. Use it at your own risk — I'm not responsible for any issues it may cause.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[ISC](LICENSE)
