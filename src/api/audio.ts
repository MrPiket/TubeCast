import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as db from '../db';
import config, { AUDIO_MIME_TYPES } from '../config';
import { DownloadProgress } from '../types';
import { isValidVideoId } from '../validate';

const router = Router();

const CACHE_DIR: string = path.join(config.DATA_DIR, 'audio-cache');

// Downloads are staged here and only moved into CACHE_DIR once yt-dlp exits
// cleanly. Without this a download killed mid-flight (timeout, container
// restart, OOM) leaves a truncated file that looks cached forever.
const STAGING_DIR: string = path.join(CACHE_DIR, '.incoming');

const AUDIO_EXTENSIONS: string[] = Object.keys(AUDIO_MIME_TYPES).map(f => (f === 'vorbis' ? 'ogg' : f));

const downloads: Record<string, DownloadProgress> = {};
const MAX_CONCURRENT_DOWNLOADS = 3;
let activeDownloads = 0;

fs.mkdirSync(STAGING_DIR, { recursive: true });

// yt-dlp messages that mean "this will never succeed, stop retrying".
const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /video unavailable/i,
  /video is unavailable/i,
  /removed by the uploader/i,
  /this video has been removed/i,
  /private video/i,
  /members[- ]only/i,
  /video is not available/i,
  /account associated with this video has been terminated/i,
  /who has blocked it on copyright grounds/i,
  /video has been removed for violating/i,
];

export function isPermanentDownloadError(message: string): boolean {
  return PERMANENT_ERROR_PATTERNS.some(re => re.test(message));
}

function extensionFor(file: string): string {
  return path.extname(file).replace('.', '').toLowerCase();
}

function isAudioFile(file: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionFor(file));
}

function listCacheFiles(): string[] {
  return fs.readdirSync(CACHE_DIR).filter(f => !f.startsWith('.'));
}

function findFilesForVideo(videoId: string): string[] {
  return listCacheFiles().filter(f => f.startsWith(`${videoId}.`));
}

function findCachedFile(videoId: string): string | null {
  const files = findFilesForVideo(videoId).filter(isAudioFile);
  if (files.length === 0) return null;
  // Prefer the configured format when several generations coexist.
  const preferred = files.find(f => extensionFor(f) === config.AUDIO_FORMAT);
  return path.join(CACHE_DIR, preferred || files[0]);
}

function mimeTypeFor(filePath: string): string {
  const ext = extensionFor(filePath);
  if (ext === 'ogg') return AUDIO_MIME_TYPES.vorbis;
  return AUDIO_MIME_TYPES[ext as keyof typeof AUDIO_MIME_TYPES] || 'application/octet-stream';
}

function clearVideoCache(videoId: string): number {
  let count = 0;
  for (const file of findFilesForVideo(videoId)) {
    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch { /* ignore */ }
  }
  clearStagingFor(videoId);
  return count;
}

function clearStagingFor(videoId: string): void {
  try {
    for (const file of fs.readdirSync(STAGING_DIR)) {
      if (file.startsWith(`${videoId}.`)) {
        try { fs.unlinkSync(path.join(STAGING_DIR, file)); } catch { /* ignore */ }
      }
    }
  } catch { /* staging dir may not exist yet */ }
}

// Moves the finished download out of staging and returns its final path.
function promoteFromStaging(videoId: string): string | null {
  const produced = fs.readdirSync(STAGING_DIR)
    .filter(f => f.startsWith(`${videoId}.`) && isAudioFile(f));

  if (produced.length === 0) return null;

  const source = produced.find(f => extensionFor(f) === config.AUDIO_FORMAT) || produced[0];
  const target = path.join(CACHE_DIR, `${videoId}.${extensionFor(source)}`);

  fs.renameSync(path.join(STAGING_DIR, source), target);
  clearStagingFor(videoId);
  return target;
}

function downloadVideo(videoId: string): Promise<void> {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return Promise.reject(new Error('Too many concurrent downloads'));
  }
  activeDownloads++;

  return new Promise<void>((resolve, reject) => {
    clearStagingFor(videoId);
    const outputTemplate = path.join(STAGING_DIR, `${videoId}.%(ext)s`);

    downloads[videoId] = { status: 'downloading', percent: 0 };

    // detached gives yt-dlp its own process group, so the timeout below can
    // kill the ffmpeg it spawned too instead of orphaning it.
    const proc = spawn('yt-dlp', [
      // Prefer a source already in the target container. YouTube's best audio
      // is usually opus, so without this -x would still run every download
      // through ffmpeg just to reach m4a. Falls back to bestaudio (and a real
      // conversion) when no such source exists.
      '-f', `bestaudio[ext=${config.AUDIO_SOURCE_EXT}]/bestaudio`,
      '-x',
      '--audio-format', config.AUDIO_FORMAT,
      '--audio-quality', '128K',
      '--newline',
      '-o', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { detached: true });

    const stderrTail: string[] = [];

    function handleOutput(line: string, isStderr: boolean): void {
      if (!line) return;

      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        downloads[videoId] = { status: 'downloading', percent: Number.parseFloat(match[1]) };
        return;
      }

      if (line.includes('[ExtractAudio]') || line.includes('[Postprocess') || line.includes('[ffmpeg]')) {
        downloads[videoId] = { status: 'converting', percent: 100 };
        return;
      }

      if (isStderr) {
        stderrTail.push(line);
        if (stderrTail.length > 20) stderrTail.shift();
        console.error(`[${new Date().toISOString()}] [yt-dlp] ${line}`);
      }
    }

    proc.stderr.on('data', (data: Buffer) => handleOutput(data.toString().trim(), true));
    proc.stdout.on('data', (data: Buffer) => handleOutput(data.toString().trim(), false));

    // 'error' and 'close' can both fire for the same process (a failed spawn
    // emits each one), so settle exactly once or the concurrency counter drifts.
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(proc.pid);
    }, 600000);

    function settle(err: Error | null): void {
      if (settled) return;
      settled = true;
      activeDownloads--;
      clearTimeout(timeout);

      if (err) {
        downloads[videoId] = { status: 'error', percent: 0 };
        clearStagingFor(videoId);
        reject(err);
        return;
      }

      downloads[videoId] = { status: 'done', percent: 100 };
      resolve();
    }

    proc.on('close', (code: number | null) => {
      if (timedOut) {
        settle(new Error('Download timed out'));
        return;
      }
      if (code !== 0) {
        const detail = stderrTail.filter(l => /ERROR/i.test(l)).pop() || `yt-dlp exited with code ${code}`;
        settle(new Error(detail));
        return;
      }
      try {
        if (!promoteFromStaging(videoId)) {
          settle(new Error('Download completed but no audio file was produced'));
          return;
        }
      } catch (err) {
        settle(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      settle(null);
    });

    proc.on('error', (err: Error) => settle(err));
  });
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    // Negative pid targets the whole process group created by detached: true.
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

function cleanupCache(): void {
  const maxAge = config.AUDIO_CACHE_TTL_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  let cleaned = 0;

  // Anything left in staging belongs to a download that never finished.
  try {
    for (const file of fs.readdirSync(STAGING_DIR)) {
      try { fs.unlinkSync(path.join(STAGING_DIR, file)); cleaned++; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  let staleFormat = 0;
  for (const file of listCacheFiles()) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      if (isAudioFile(file) && extensionFor(file) !== config.AUDIO_FORMAT) {
        fs.unlinkSync(filePath);
        staleFormat++;
        continue;
      }

      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // ignore errors on individual files
    }
  }
  if (staleFormat > 0) {
    console.log(`[audio] Evicted ${staleFormat} cached file(s) not in ${config.AUDIO_FORMAT} format`);
  }
  if (cleaned > 0) {
    console.log(`[audio] Cleaned up ${cleaned} cached file(s) older than ${config.AUDIO_CACHE_TTL_HOURS}h`);
  }
}

cleanupCache();
setInterval(cleanupCache, 60 * 60 * 1000);

// GET /audio/progress/:videoId
router.get('/progress/:videoId', (req: Request, res: Response) => {
  const videoId = req.params.videoId as string;
  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }
  const cached = !!findCachedFile(videoId);
  if (cached) {
    res.json({ status: 'done', percent: 100 });
    return;
  }
  const progress = downloads[videoId];
  if (progress) {
    res.json(progress);
    return;
  }
  res.json({ status: 'none', percent: 0 });
});

// GET /audio/cache/info
router.get('/cache/info', (_req: Request, res: Response) => {
  const files = listCacheFiles().filter(isAudioFile);
  let totalSize = 0;
  const cached: Array<{ videoId: string; size: number; cachedAt: number }> = [];

  for (const file of files) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      totalSize += stat.size;
      cached.push({
        videoId: path.basename(file, path.extname(file)),
        size: stat.size,
        cachedAt: stat.mtimeMs,
      });
    } catch { /* ignore */ }
  }

  res.json({ count: cached.length, totalSize, files: cached });
});

// GET /audio/:videoId.:ext — the extension is ignored, whatever is cached is
// served with its real MIME type. Feeds published before the format changed
// still point at .mp3 URLs and keep working.
router.get('/:filename', async (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  const videoId = path.basename(filename, path.extname(filename));

  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }

  try {
    let filePath = findCachedFile(videoId);

    if (!filePath) {
      if (db.isUnavailable(videoId)) {
        res.status(410).json({ error: 'Audio is no longer available from YouTube' });
        return;
      }

      console.log(`[audio] Downloading ${videoId}`);
      await downloadVideo(videoId);

      filePath = findCachedFile(videoId);
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('Download completed but output file not found');
      }

      setTimeout(() => { delete downloads[videoId]; }, 60000);

      console.log(`[audio] Downloaded ${videoId}`);
      db.clearDownloadFailures(videoId);
    }

    db.incrementDownloadCount(videoId);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const contentType = mimeTypeFor(filePath);

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toISOString()}] [audio] Error for ${videoId}:`, message);
    clearVideoCache(videoId);
    db.recordDownloadFailure(videoId, message, isPermanentDownloadError(message));
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to load audio' });
    }
  }
});

// POST /audio/cache/:videoId — pre-cache without streaming
router.post('/cache/:videoId', async (req: Request, res: Response) => {
  const videoId = req.params.videoId as string;
  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }

  if (findCachedFile(videoId)) {
    res.json({ status: 'already_cached' });
    return;
  }

  if (downloads[videoId] && downloads[videoId].status === 'downloading') {
    res.json({ status: 'in_progress' });
    return;
  }

  downloadVideo(videoId).then(() => {
    db.clearDownloadFailures(videoId);
    setTimeout(() => { delete downloads[videoId]; }, 60000);
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audio] Cache download failed for ${videoId}: ${message}`);
    db.recordDownloadFailure(videoId, message, isPermanentDownloadError(message));
  });

  res.json({ status: 'started' });
});

// DELETE /audio/cache
router.delete('/cache', (_req: Request, res: Response) => {
  let count = 0;
  for (const file of listCacheFiles()) {
    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch { /* ignore */ }
  }
  console.log(`[audio] Cleared ${count} cached file(s)`);
  res.json({ cleared: count });
});

// DELETE /audio/cache/:videoId
router.delete('/cache/:videoId', (req: Request, res: Response) => {
  const videoId = req.params.videoId as string;
  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }
  const count = clearVideoCache(videoId);
  if (count > 0) {
    console.log(`[audio] Cleared cache for ${videoId}`);
  }
  res.json({ cleared: count > 0 });
});

export { router, CACHE_DIR, findCachedFile, clearVideoCache, downloadVideo };
