import path from 'path';
import { Config, AudioFormat } from './types';

// Formats yt-dlp can produce with -x, and the MIME type each one needs in the
// RSS enclosure. m4a is the default because YouTube already serves AAC: yt-dlp
// copies the stream instead of running it through ffmpeg, which is the whole
// cost of a download for a 2-hour podcast.
export const AUDIO_MIME_TYPES: Record<AudioFormat, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  vorbis: 'audio/ogg',
};

function parseAudioFormat(value: string | undefined): AudioFormat {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized in AUDIO_MIME_TYPES) {
    return normalized as AudioFormat;
  }
  if (normalized) {
    console.warn(`[config] Unsupported AUDIO_FORMAT "${value}", falling back to m4a`);
  }
  return 'm4a';
}

const DATA_DIR: string = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT: number = parseInt(process.env.PORT ?? '', 10) || 3000;
const FEED_BASE_URL: string = process.env.FEED_BASE_URL || `http://localhost:${PORT}`;
const POLL_INTERVAL_MINUTES: number = parseInt(process.env.POLL_INTERVAL_MINUTES ?? '', 10) || 15;
const INITIAL_EPISODES: number = parseInt(process.env.INITIAL_EPISODES ?? '', 10) || 15;
const AUDIO_CACHE_TTL_HOURS: number = parseInt(process.env.AUDIO_CACHE_TTL_HOURS ?? '', 10) || 24;
const AUDIO_FORMAT: AudioFormat = parseAudioFormat(process.env.AUDIO_FORMAT);
const MAX_DOWNLOAD_ATTEMPTS: number = parseInt(process.env.MAX_DOWNLOAD_ATTEMPTS ?? '', 10) || 3;

// Container extension to look for in the source, per target format. opus and
// vorbis both live in webm on YouTube.
const AUDIO_SOURCE_EXTS: Record<AudioFormat, string> = {
  m4a: 'm4a',
  aac: 'm4a',
  mp3: 'mp3',
  opus: 'webm',
  vorbis: 'webm',
  flac: 'flac',
  wav: 'wav',
};

const config: Config = {
  DATA_DIR,
  PORT,
  FEED_BASE_URL,
  POLL_INTERVAL_MINUTES,
  INITIAL_EPISODES,
  AUDIO_CACHE_TTL_HOURS,
  AUDIO_FORMAT,
  AUDIO_MIME_TYPE: AUDIO_MIME_TYPES[AUDIO_FORMAT],
  AUDIO_SOURCE_EXT: AUDIO_SOURCE_EXTS[AUDIO_FORMAT],
  MAX_DOWNLOAD_ATTEMPTS,
  DB_PATH: path.join(DATA_DIR, 'tubecast.db'),
};

export default config;
