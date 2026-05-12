import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as db from '../db';
import config from '../config';
import { DownloadProgress } from '../types';
import { isValidVideoId } from '../validate';

const router = Router();

const CACHE_DIR: string = path.join(config.DATA_DIR, 'audio-cache');

const downloads: Record<string, DownloadProgress> = {};
const MAX_CONCURRENT_DOWNLOADS = 3;
let activeDownloads = 0;

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function findFilesForVideo(videoId: string): string[] {
  return fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(videoId));
}

function findCachedFile(videoId: string): string | null {
  const files = findFilesForVideo(videoId).filter(f => f.endsWith('.mp3') && !f.includes('.part'));
  return files.length > 0 ? path.join(CACHE_DIR, files[0]) : null;
}

function clearVideoCache(videoId: string): number {
  let count = 0;
  for (const file of findFilesForVideo(videoId)) {
    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch { /* ignore */ }
  }
  return count;
}

function downloadVideo(videoId: string): Promise<void> {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return Promise.reject(new Error('Too many concurrent downloads'));
  }
  activeDownloads++;

  return new Promise<void>((resolve, reject) => {
    const outputTemplate = path.join(CACHE_DIR, `${videoId}.%(ext)s`);

    downloads[videoId] = { status: 'downloading', percent: 0 };

    const proc = spawn('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      '--no-part',
      '--force-overwrites',
      '--newline',
      '-o', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
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

      console.error(`[${new Date().toISOString()}] [yt-dlp] ${line}`);
    });

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (!line) return;

      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        downloads[videoId] = { status: 'downloading', percent: Number.parseFloat(match[1]) };
        return;
      }

      if (line.includes('[ExtractAudio]') || line.includes('[Postprocess') || line.includes('[ffmpeg]')) {
        downloads[videoId] = { status: 'converting', percent: 100 };
      }
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, 600000);

    proc.on('close', (code: number | null) => {
      activeDownloads--;
      clearTimeout(timeout);
      if (timedOut) {
        downloads[videoId] = { status: 'error', percent: 0 };
        reject(new Error('Download timed out'));
      } else if (code === 0) {
        downloads[videoId] = { status: 'done', percent: 100 };
        resolve();
      } else {
        downloads[videoId] = { status: 'error', percent: 0 };
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err: Error) => {
      activeDownloads--;
      clearTimeout(timeout);
      downloads[videoId] = { status: 'error', percent: 0 };
      reject(err);
    });
  });
}

function cleanupCache(): void {
  const maxAge = config.AUDIO_CACHE_TTL_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  let cleaned = 0;
  for (const file of fs.readdirSync(CACHE_DIR)) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      if (file.includes('.part')) {
        fs.unlinkSync(filePath);
        cleaned++;
        continue;
      }
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // ignore errors on individual files
    }
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

// GET /audio/:videoId.mp3
router.get('/:videoId.mp3', async (req: Request, res: Response) => {
  const videoId = req.params.videoId as string;
  if (!isValidVideoId(videoId)) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }

  try {
    let filePath = findCachedFile(videoId);

    if (!filePath) {
      console.log(`[audio] Downloading ${videoId}`);

      await downloadVideo(videoId);

      filePath = findCachedFile(videoId);
      if (filePath) {
        const cleanPath = path.join(CACHE_DIR, `${videoId}.mp3`);
        if (filePath !== cleanPath) {
          fs.renameSync(filePath, cleanPath);
          filePath = cleanPath;
        }
      }

      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('Download completed but output file not found');
      }

      setTimeout(() => { delete downloads[videoId]; }, 60000);

      console.log(`[audio] Downloaded ${videoId}`);
    }

    db.incrementDownloadCount(videoId);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

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
        'Content-Type': 'audio/mpeg',
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [audio] Error for ${videoId}:`, err instanceof Error ? err.message : String(err));
    clearVideoCache(videoId);
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

  try {
    downloadVideo(videoId).then(() => {
      const filePath = findCachedFile(videoId);
      if (filePath) {
        const cleanPath = path.join(CACHE_DIR, `${videoId}.mp3`);
        if (filePath !== cleanPath) {
          fs.renameSync(filePath, cleanPath);
        }
      }
      setTimeout(() => { delete downloads[videoId]; }, 60000);
    }).catch((err) => {
      console.error(`[audio] Cache download failed for ${videoId}:`, err instanceof Error ? err.message : String(err));
    });
    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start download' });
  }
});

// DELETE /audio/cache
router.delete('/cache', (_req: Request, res: Response) => {
  let count = 0;
  for (const file of fs.readdirSync(CACHE_DIR)) {
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

// GET /audio/cache/info
router.get('/cache/info', (_req: Request, res: Response) => {
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3') && !f.includes('.part'));
  let totalSize = 0;
  const cached: Array<{ videoId: string; size: number; cachedAt: number }> = [];

  for (const file of files) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      totalSize += stat.size;
      cached.push({
        videoId: file.replace('.mp3', ''),
        size: stat.size,
        cachedAt: stat.mtimeMs,
      });
    } catch { /* ignore */ }
  }

  res.json({ count: cached.length, totalSize, files: cached });
});

export { router, CACHE_DIR, findCachedFile, clearVideoCache, downloadVideo };
