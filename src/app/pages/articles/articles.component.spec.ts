import { Event } from 'nostr-tools';

import { filterVisibleArticles } from './articles.component';

function createArticleEvent(id: string, pubkey: string, createdAt: number): Event {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 30023,
    tags: [['d', id]],
    content: `article-${id}`,
    sig: `sig-${id}`,
  };
}

describe('filterVisibleArticles', () => {
  it('removes blocked articles from the rendered listing', () => {
    const articles = [
      createArticleEvent('a', 'pubkey-a', 1),
      createArticleEvent('b', 'pubkey-b', 2),
      createArticleEvent('c', 'pubkey-c', 3),
    ];

    const visible = filterVisibleArticles(articles, article => article.pubkey === 'pubkey-b');

    expect(visible.map(article => article.id)).toEqual(['a', 'c']);
  });

  it('preserves the order of visible articles', () => {
    const articles = [
      createArticleEvent('first', 'pubkey-a', 1),
      createArticleEvent('second', 'pubkey-b', 2),
      createArticleEvent('third', 'pubkey-c', 3),
    ];

    const visible = filterVisibleArticles(articles, article => article.id === 'second');

    expect(visible.map(article => article.id)).toEqual(['first', 'third']);
  });
});