import { execFile } from 'child_process';
import { promisify } from 'util';
import { ParsedUrl, YtDlpVideo } from '../types';
import { isValidVideoId } from '../validate';

const execFileAsync = promisify(execFile);

export function parseYoutubeUrl(url: string): ParsedUrl {
  const u = new URL(url);
  const hostname = u.hostname.replace('www.', '');

  if (hostname !== 'youtube.com' && hostname !== 'youtu.be' && hostname !== 'm.youtube.com') {
    throw new Error('Not a valid YouTube URL');
  }

  // Playlist
  const listId = u.searchParams.get('list');
  if (listId) {
    return { type: 'playlist', youtubeId: listId };
  }

  // Channel - /channel/UCxxxx
  const channelMatch = u.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch) {
    return { type: 'channel', youtubeId: channelMatch[1] };
  }

  // Handle - /@handle
  const handleMatch = u.pathname.match(/^\/@([a-zA-Z0-9_.-]+)/);
  if (handleMatch) {
    return { type: 'channel', youtubeId: `@${handleMatch[1]}` };
  }

  // Channel - /c/name or /user/name
  const legacyMatch = u.pathname.match(/^\/(c|user)\/([a-zA-Z0-9_.-]+)/);
  if (legacyMatch) {
    return { type: 'channel', youtubeId: legacyMatch[2] };
  }

  // Single video - youtu.be/ID or /watch?v=ID
  if (hostname === 'youtu.be') {
    const videoId = u.pathname.slice(1);
    if (videoId) return { type: 'video', youtubeId: videoId };
  }
  const videoId = u.searchParams.get('v');
  if (videoId) {
    return { type: 'video', youtubeId: videoId };
  }

  throw new Error('Could not parse YouTube URL');
}

export async function fetchMetadata(url: string, type: string, maxEntries: number = 10): Promise<YtDlpVideo[]> {
  const args: string[] = [
    '--dump-json',
    '--no-download',
    '--playlist-end', String(maxEntries),
    '--no-warnings',
    url,
  ];

  if (type === 'video') {
    const idx = args.indexOf('--playlist-end');
    if (idx !== -1) {
      args.splice(idx, 2);
    }
  }

  const { stdout } = await execFileAsync('yt-dlp', args, {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000,
  });

  const lines = stdout.trim().split('\n').filter(Boolean);
  const entries: YtDlpVideo[] = lines.map(line => JSON.parse(line) as YtDlpVideo);

  return entries;
}

export async function fetchVideoMeta(videoId: string): Promise<YtDlpVideo> {
  if (!isValidVideoId(videoId)) {
    throw new Error('Invalid video ID');
  }
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args: string[] = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    url,
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });

  return JSON.parse(stdout.trim()) as YtDlpVideo;
}

export function resolveUrl(parsed: ParsedUrl): string {
  switch (parsed.type) {
    case 'channel':
      if (parsed.youtubeId.startsWith('@')) {
        return `https://www.youtube.com/${parsed.youtubeId}/videos`;
      }
      if (parsed.youtubeId.startsWith('UC')) {
        return `https://www.youtube.com/channel/${parsed.youtubeId}/videos`;
      }
      return `https://www.youtube.com/c/${parsed.youtubeId}/videos`;
    case 'playlist':
      return `https://www.youtube.com/playlist?list=${parsed.youtubeId}`;
    case 'video':
      return `https://www.youtube.com/watch?v=${parsed.youtubeId}`;
    default:
      throw new Error(`Unknown type: ${(parsed as ParsedUrl).type}`);
  }
}

export function isShort(entry: YtDlpVideo): boolean {
  const duration = entry.duration || 0;
  if (duration > 60) return false;
  const title = entry.title || '';
  if (title.toLowerCase().includes('#shorts')) return true;
  const width = entry.width || 0;
  const height = entry.height || 0;
  if (width > 0 && height > 0 && height > width) return true;
  return false;
}

export function isLive(entry: YtDlpVideo): boolean {
  return !!(entry.is_live || entry.was_live || entry.live_status === 'was_live');
}

export function extractVideoId(entry: YtDlpVideo): string | undefined {
  return entry.id || entry.url || entry.webpage_url?.split('v=')[1];
}
