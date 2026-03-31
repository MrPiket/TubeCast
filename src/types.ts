export interface Subscription {
  id: string;
  type: 'channel' | 'playlist' | 'video';
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  original_url: string;
  created_at: number;
  last_checked_at: number | null;
  filter_lives: 0 | 1;
  filter_shorts: 0 | 1;
  filter_min_duration: number;
  filter_max_duration: number;
}

export interface Episode {
  id: string;
  subscription_id: string;
  video_id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  published_at: number | null;
  duration_sec: number | null;
  is_live: 0 | 1;
  is_short: 0 | 1;
  download_count: number;
  created_at: number;
}

export interface Job {
  id: number;
  type: 'download_audio' | 'check_feed';
  payload: string;
  status: 'pending' | 'running' | 'done' | 'error';
  attempts: number;
  last_error: string | null;
  created_at: number;
  run_after: number;
}

export interface ParsedUrl {
  type: 'channel' | 'playlist' | 'video';
  youtubeId: string;
}

export interface YtDlpVideo {
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url: string }>;
  duration?: number;
  is_live?: boolean;
  was_live?: boolean;
  live_status?: string;
  width?: number;
  height?: number;
  channel?: string;
  uploader?: string;
  channel_url?: string;
  playlist_title?: string;
  playlist?: string;
  playlist_description?: string;
  timestamp?: number;
  upload_date?: string;
}

export interface DownloadProgress {
  status: 'downloading' | 'converting' | 'done' | 'error' | 'none';
  percent: number;
}

export interface CreateSubscriptionInput {
  id: string;
  type: 'channel' | 'playlist' | 'video';
  youtube_id: string;
  title: string;
  description: string;
  thumbnail: string;
  original_url: string;
  created_at: number;
}

export interface CreateEpisodeInput {
  id: string;
  subscription_id: string;
  video_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: number | null;
  duration_sec: number | null;
  is_live: boolean;
  is_short: boolean;
  created_at: number;
}

export interface FilterInput {
  filter_lives?: number;
  filter_shorts?: number;
  filter_min_duration?: number;
  filter_max_duration?: number;
}

export interface Config {
  DATA_DIR: string;
  PORT: number;
  FEED_BASE_URL: string;
  POLL_INTERVAL_MINUTES: number;
  INITIAL_EPISODES: number;
  AUDIO_CACHE_TTL_HOURS: number;
  DB_PATH: string;
}
