# TubeCast

Turn any YouTube channel, playlist, or video into a podcast RSS feed. Subscribe in your favorite podcast app and listen to YouTube content as audio — on the go, offline, however you want.

## How It Works

1. Paste a YouTube URL (channel, playlist, or single video)
2. TubeCast fetches the video metadata and generates a podcast-compatible RSS feed
3. Copy the feed URL into any podcast app (Apple Podcasts, Overcast, Pocket Casts, etc.)
4. Audio is streamed on-demand — converted to MP3 in real time when your podcast app requests it

```
YouTube URL → TubeCast → RSS Feed → Your Podcast App
                                         ↓
                                    Audio on demand
```

## Features

- **Channels, Playlists & Single Videos** — supports any YouTube URL format including `@handles`, `/channel/`, `/c/`, `/user/`, and `youtu.be` short links
- **Real-Time Audio Streaming** — no storage needed; audio is extracted and converted to MP3 via yt-dlp + ffmpeg on the fly
- **Automatic Polling** — new episodes are discovered automatically on a configurable schedule
- **Episode Filters** — filter out livestreams, shorts, or set min/max duration thresholds per subscription
- **iTunes-Compatible RSS** — proper `<itunes:*>` tags, episode artwork, and durations so feeds look great in any podcast app
- **Web Dashboard** — simple UI to create feeds, manage subscriptions, and browse episodes
- **REST API** — full CRUD API for subscriptions and filters at `/api/subscriptions`
- **SQLite Storage** — lightweight, zero-config database with WAL mode and automatic migrations
- **Docker Ready** — single container with everything included

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
```

Open **http://localhost:5151** and paste a YouTube URL.

### Without Docker

Requires [Node.js](https://nodejs.org/) 20+, [ffmpeg](https://ffmpeg.org/), and [yt-dlp](https://github.com/yt-dlp/yt-dlp).

```bash
# Install system dependencies (macOS)
brew install ffmpeg yt-dlp

# Install Node dependencies
npm install

# Run
npm start
```

Open **http://localhost:3000**.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` | Directory for SQLite database |
| `FEED_BASE_URL` | `http://localhost:$PORT` | Public URL used in RSS feed links (set this to your domain in production) |
| `POLL_INTERVAL_MINUTES` | `15` | How often to check for new episodes |
| `INITIAL_EPISODES` | `10` | Number of episodes to fetch on first subscription |

## API

### Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/subscriptions` | Create subscription (`{ "url": "..." }`) |
| `GET` | `/api/subscriptions` | List all subscriptions |
| `GET` | `/api/subscriptions/:id` | Get subscription with episodes |
| `PATCH` | `/api/subscriptions/:id/filters` | Update filters |
| `DELETE` | `/api/subscriptions/:id` | Delete subscription |

### Feeds & Audio

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/feed/:id.xml` | RSS feed for a subscription |
| `GET` | `/audio/:videoId.mp3` | Stream audio for a video |

## Project Structure

```
TubeCast/
├── index.js              # Express app entry point
├── src/
│   ├── config.js         # Environment configuration
│   ├── api/
│   │   ├── views.js      # Web UI routes
│   │   ├── subscriptions.js  # REST API
│   │   ├── feed.js       # RSS feed endpoint
│   │   └── audio.js      # Audio streaming endpoint
│   ├── db/
│   │   ├── index.js      # Database access layer
│   │   └── schema.js     # Migrations
│   ├── rss/
│   │   └── index.js      # RSS XML generation
│   ├── scheduler/
│   │   └── index.js      # Cron-based polling
│   ├── youtube/
│   │   └── index.js      # yt-dlp wrapper & URL parsing
│   └── views/            # EJS templates
├── public/               # Static assets
├── Dockerfile
└── docker-compose.yml
```

## License

ISC
