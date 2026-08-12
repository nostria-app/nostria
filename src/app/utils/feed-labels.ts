/**
 * Display labels for built-in feeds. Custom feed names stay as the user typed them.
 */
export function localizedFeedLabel(feed: { id: string; label: string }): string {
  switch (feed.id) {
    case 'default-feed-for-you':
      return $localize`:@@feeds.for-you:For You`;
    case 'default-feed-following':
      return $localize`:@@feeds.following:Following`;
    case 'default-feed-trending':
      return $localize`:@@feeds.trending:Trending`;
    default:
      return feed.label;
  }
}
