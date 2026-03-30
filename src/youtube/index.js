const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Parse a YouTube URL and return its type and ID.
 */
function parseYoutubeUrl(url) {
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

/**
 * Fetch metadata for a channel/playlist/video using yt-dlp --dump-json.
 * Returns { meta, entries } where meta has channel/playlist info and entries is an array of video metadata.
 */
async function fetchMetadata(url, type, maxEntries = 10) {
  const args = [
    '--dump-json',
    '--no-download',
    '--playlist-end', String(maxEntries),
    '--no-warnings',
    url,
  ];

  if (type === 'video') {
    // For a single video, don't limit playlist entries
    args.splice(args.indexOf('--playlist-end'), 2);
  }

  const { stdout } = await execFileAsync('yt-dlp', args, {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000,
  });

  const lines = stdout.trim().split('\n').filter(Boolean);
  const entries = lines.map(line => JSON.parse(line));

  return entries;
}

/**
 * Fetch full metadata for a single video (non-flat, includes duration etc.).
 */
async function fetchVideoMeta(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    '--dump-json',
    '--no-download',
    '--no-warnings',
    url,
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });

  return JSON.parse(stdout.trim());
}

/**
 * Resolve URL to a canonical form for yt-dlp fetching.
 */
function resolveUrl(parsed) {
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
      throw new Error(`Unknown type: ${parsed.type}`);
  }
}

/**
 * Detect if a video is a Short.
 * Heuristic: duration <= 60s AND (title contains #Shorts or aspect ratio is vertical).
 */
function isShort(entry) {
  const duration = entry.duration || 0;
  if (duration > 60) return false;
  const title = entry.title || '';
  if (title.toLowerCase().includes('#shorts')) return true;
  const width = entry.width || 0;
  const height = entry.height || 0;
  if (width > 0 && height > 0 && height > width) return true;
  return false;
}

/**
 * Detect if a video is/was a live stream.
 */
function isLive(entry) {
  return !!(entry.is_live || entry.was_live || entry.live_status === 'was_live');
}

/**
 * Extract a consistent video ID from a yt-dlp entry (flat or full).
 */
function extractVideoId(entry) {
  return entry.id || entry.url || entry.webpage_url?.split('v=')[1];
}

/**
 * Fetch channel/playlist metadata (title, description, thumbnail) by scraping the first entry
 * or using a separate yt-dlp call.
 */
async function fetchContainerMeta(url) {
  const args = [
    '--dump-json',
    '--no-download',
    '--flat-playlist',
    '--playlist-end', '1',
    '--print', '%(playlist_title)s\n%(playlist_id)s\n%(playlist_uploader)s',
    '--no-warnings',
    url,
  ];

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });
    return stdout;
  } catch {
    return null;
  }
}

module.exports = {
  parseYoutubeUrl,
  fetchMetadata,
  fetchVideoMeta,
  resolveUrl,
  isShort,
  isLive,
  extractVideoId,
};
