// The networks people actually live on, most telling first. User Profiling
// checks these before everything else and one per request, so a slow batch of
// lesser sites can't hold them up, and it draws the headline avatar from the
// highest-ranked one that has a picture.

export const PRIORITY_SITES = [
  'Instagram',
  'Facebook',
  'X (Twitter)',
  'Threads',
  'TikTok',
  'Discord',
  'Tumblr',
  'Bluesky',
  'Substack',
  'YouTube',
  'Reddit',
  'Snapchat',
  'Telegram',
  'Pinterest',
  'Twitch',
  'Kick',
  'Ko-fi',
  'Linktree',
  'Mastodon',
  'GitHub',
  'Spotify',
  'SoundCloud',
  'VK',
  'Carousell',
];

const RANK = new Map(PRIORITY_SITES.map((name, i) => [name, i]));

// 0 for Instagram, 1 for Facebook…, Infinity for anything not listed. Smaller
// is more important, so a plain numeric sort puts the big networks first.
export const priorityOf = (name) => RANK.get(name) ?? Infinity;

export const isPriority = (name) => RANK.has(name);
