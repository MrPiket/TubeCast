const { Router } = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');

const router = Router();

const CACHE_DIR = path.join(config.DATA_DIR, 'audio-cache');

// In-memory download progress tracking
// { videoId: { status: 'downloading'|'converting'|'done'|'error', percent: 0-100 } }
const downloads = {};

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Find all files in CACHE_DIR that belong to a given videoId.
 */
function findFilesForVideo(videoId) {
  return fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(videoId));
}

/**
 * Find the final cached mp3 for a videoId (not .part files).
 */
function findCachedFile(videoId) {
  const files = findFilesForVideo(videoId).filter(f => f.endsWith('.mp3') && !f.includes('.part'));
  return files.length > 0 ? path.join(CACHE_DIR, files[0]) : null;
}

/**
 * Remove all files in CACHE_DIR that belong to a given videoId.
 */
function clearVideoCache(videoId) {
  let count = 0;
  for (const file of findFilesForVideo(videoId)) {
    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch {}
  }
  return count;
}

/**
 * Download a video as mp3, tracking progress. Returns a promise.
 */
function downloadVideo(videoId) {
  return new Promise((resolve, reject) => {
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

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (!line) return;

      // yt-dlp progress: [download]  45.2% of 10.00MiB ...
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        downloads[videoId] = { status: 'downloading', percent: Number.parseFloat(match[1]) };
        return;
      }

      // Post-processing / conversion
      if (line.includes('[ExtractAudio]') || line.includes('[Postprocess') || line.includes('[ffmpeg]')) {
        downloads[videoId] = { status: 'converting', percent: 100 };
        return;
      }

      console.error(`[${new Date().toISOString()}] [yt-dlp] ${line}`);
    });

    proc.stdout.on('data', (data) => {
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

    const timeout = setTimeout(() => {
      proc.kill();
      downloads[videoId] = { status: 'error', percent: 0 };
      reject(new Error('Download timed out'));
    }, 600000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        downloads[videoId] = { status: 'done', percent: 100 };
        resolve();
      } else {
        downloads[videoId] = { status: 'error', percent: 0 };
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      downloads[videoId] = { status: 'error', percent: 0 };
      reject(err);
    });
  });
}

// Clean up cached audio files older than the configured TTL
function cleanupCache() {
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

// Run cleanup every hour
cleanupCache();
setInterval(cleanupCache, 60 * 60 * 1000);

// GET /audio/progress/:videoId — Get download progress
router.get('/progress/:videoId', (req, res) => {
  const { videoId } = req.params;
  const cached = !!findCachedFile(videoId);
  if (cached) {
    return res.json({ status: 'done', percent: 100 });
  }
  const progress = downloads[videoId];
  if (progress) {
    return res.json(progress);
  }
  res.json({ status: 'none', percent: 0 });
});

// GET /audio/:videoId.mp3 — Serve audio with proper headers for podcast apps
router.get('/:videoId.mp3', async (req, res) => {
  const { videoId } = req.params;

  try {
    let filePath = findCachedFile(videoId);

    // Download if not already cached
    if (!filePath) {
      console.log(`[audio] Downloading ${videoId}`);

      await downloadVideo(videoId);

      // Find the resulting file and rename to a clean name
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

      // Clean up progress after a delay
      setTimeout(() => { delete downloads[videoId]; }, 60000);

      console.log(`[audio] Downloaded ${videoId}`);
    }

    // Increment download counter
    db.incrementDownloadCount(videoId);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // Handle range requests (seeking, resuming)
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
    console.error(`[${new Date().toISOString()}] [audio] Error for ${videoId}:`, err.message);
    clearVideoCache(videoId);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to load audio' });
    }
  }
});

// DELETE /audio/cache — Clear all cached files
router.delete('/cache', (req, res) => {
  let count = 0;
  for (const file of fs.readdirSync(CACHE_DIR)) {
    try { fs.unlinkSync(path.join(CACHE_DIR, file)); count++; } catch {}
  }
  console.log(`[audio] Cleared ${count} cached file(s)`);
  res.json({ cleared: count });
});

// DELETE /audio/cache/:videoId — Clear a single cached file
router.delete('/cache/:videoId', (req, res) => {
  const count = clearVideoCache(req.params.videoId);
  if (count > 0) {
    console.log(`[audio] Cleared cache for ${req.params.videoId}`);
  }
  res.json({ cleared: count > 0 });
});

// GET /audio/cache/info — Get cache stats
router.get('/cache/info', (req, res) => {
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3') && !f.includes('.part'));
  let totalSize = 0;
  const cached = [];

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
    } catch {}
  }

  res.json({ count: cached.length, totalSize, files: cached });
});

module.exports = { router, CACHE_DIR, findCachedFile, clearVideoCache };
