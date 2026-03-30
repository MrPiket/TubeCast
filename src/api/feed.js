const { Router } = require('express');
const db = require('../db');
const { generateFeed } = require('../rss');

const router = Router();

// GET /feed/:id.xml — RSS feed for a subscription
router.get('/:id.xml', (req, res) => {
  const sub = db.getSubscription(req.params.id);
  if (!sub) {
    return res.status(404).send('Feed not found');
  }

  const episodes = db.getFilteredEpisodes(sub);
  const xml = generateFeed(sub, episodes);

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(xml);
});

module.exports = router;
