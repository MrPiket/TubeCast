import config from '../config';
import { Subscription, Episode } from '../types';

function escXml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escCdata(str: string | null | undefined): string {
  if (!str) return '';
  return String(str).replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toRfc2822(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toUTCString();
}

export function generateFeed(subscription: Subscription, episodes: Episode[]): string {
  const feedUrl = `${config.FEED_BASE_URL}/feed/${subscription.id}.xml`;

  const items = episodes.map(ep => {
    const audioUrl = `${config.FEED_BASE_URL}/audio/${escXml(ep.video_id)}.${config.AUDIO_FORMAT}`;
    return `    <item>
      <title>${escXml(ep.title)}</title>
      <description><![CDATA[${escCdata(ep.description)}]]></description>
      <guid isPermaLink="false">yt:${escXml(ep.video_id)}</guid>
      <pubDate>${toRfc2822(ep.published_at)}</pubDate>
      <enclosure url="${audioUrl}" type="${config.AUDIO_MIME_TYPE}" length="0"/>
      <itunes:duration>${formatDuration(ep.duration_sec)}</itunes:duration>
      <itunes:image href="${escXml(ep.thumbnail)}"/>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(subscription.title)}</title>
    <link>${escXml(subscription.original_url)}</link>
    <description><![CDATA[${escCdata(subscription.description)}]]></description>
    <language>en</language>
    <atom:link href="${escXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <itunes:image href="${escXml(subscription.thumbnail)}"/>
    <itunes:author>${escXml(subscription.title)}</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Technology"/>
${items}
  </channel>
</rss>`;
}
