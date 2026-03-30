const path = require('path');
const express = require('express');
const config = require('./src/config');

const app = express();

// Template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/subscriptions', require('./src/api/subscriptions'));

// RSS feed
app.use('/feed', require('./src/api/feed'));

// Audio streaming
app.use('/audio', require('./src/api/audio'));

// Web views (must be last — catches / and /subscriptions/*)
app.use('/', require('./src/api/views'));

// Initialize database on startup
require('./src/db').getDb();

// Start scheduler
require('./src/scheduler').start();

app.listen(config.PORT, () => {
  console.log(`[tubecast] Server running on port ${config.PORT}`);
  console.log(`[tubecast] Feed base URL: ${config.FEED_BASE_URL}`);
});
