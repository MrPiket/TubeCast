import path from 'path';
import { Config } from './types';

const DATA_DIR: string = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT: number = parseInt(process.env.PORT ?? '', 10) || 3000;
const FEED_BASE_URL: string = process.env.FEED_BASE_URL || `http://localhost:${PORT}`;
const POLL_INTERVAL_MINUTES: number = parseInt(process.env.POLL_INTERVAL_MINUTES ?? '', 10) || 15;
const INITIAL_EPISODES: number = parseInt(process.env.INITIAL_EPISODES ?? '', 10) || 15;
const AUDIO_CACHE_TTL_HOURS: number = parseInt(process.env.AUDIO_CACHE_TTL_HOURS ?? '', 10) || 24;

const config: Config = {
  DATA_DIR,
  PORT,
  FEED_BASE_URL,
  POLL_INTERVAL_MINUTES,
  INITIAL_EPISODES,
  AUDIO_CACHE_TTL_HOURS,
  DB_PATH: path.join(DATA_DIR, 'tubecast.db'),
};

export default config;
