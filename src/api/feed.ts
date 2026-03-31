import { Router, Request, Response } from 'express';
import * as db from '../db';
import { generateFeed } from '../rss';

const router = Router();

// GET /feed/:id.xml
router.get('/:id.xml', (req: Request, res: Response) => {
  const sub = db.getSubscription(req.params.id as string);
  if (!sub) {
    res.status(404).send('Feed not found');
    return;
  }

  const episodes = db.getFilteredEpisodes(sub);
  const xml = generateFeed(sub, episodes);

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(xml);
});

export default router;
