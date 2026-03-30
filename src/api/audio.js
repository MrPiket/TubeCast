const { Router } = require('express');
const { spawn } = require('child_process');
const db = require('../db');

const router = Router();

// GET /audio/:videoId.mp3 — Stream audio in real time
router.get('/:videoId.mp3', (req, res) => {
  const { videoId } = req.params;

  // Increment download counter
  db.incrementDownloadCount(videoId);

  console.log(`[audio] Streaming ${videoId}`);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');

  const ytdlp = spawn('yt-dlp', [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '128K',
    '-o', '-',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);

  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.error(`[${new Date().toISOString()}] [yt-dlp] ${msg}`);
    }
  });

  ytdlp.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] [audio] Spawn error for ${videoId}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to start audio stream' });
    } else {
      res.destroy();
    }
  });

  ytdlp.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error(`[${new Date().toISOString()}] [audio] yt-dlp exited with code ${code} for ${videoId}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Audio stream failed' });
      }
    }
  });

  req.on('close', () => {
    if (!ytdlp.killed) {
      ytdlp.kill();
      console.log(`[audio] Client disconnected, killed yt-dlp for ${videoId}`);
    }
  });
});

module.exports = router;
