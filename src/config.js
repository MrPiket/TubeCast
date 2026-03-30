const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const FEED_BASE_URL = process.env.FEED_BASE_URL || `http://localhost:${PORT}`;
const POLL_INTERVAL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 15;
const INITIAL_EPISODES = parseInt(process.env.INITIAL_EPISODES, 10) || 10;

module.exports = {
  DATA_DIR,
  PORT,
  FEED_BASE_URL,
  POLL_INTERVAL_MINUTES,
  INITIAL_EPISODES,
  DB_PATH: path.join(DATA_DIR, 'tubecast.db'),
};
