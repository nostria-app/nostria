import { Injectable, inject, signal } from '@angular/core';
import { UtilitiesService } from './utilities.service';

/**
 * Game cover image information from IGDB
 */
export interface GameCover {
  id: number;
  imageId: string;
  url: string;
  urlSmall?: string;
  url720p?: string;
}

/**
 * Game genre information
 */
export interface GameGenre {
  id: number;
  name: string;
  slug: string;
}

/**
 * Game theme information
 */
export interface GameTheme {
  id: number;
  name: string;
  slug: string;
}

/**
 * Game platform information
 */
export interface GamePlatform {
  id: number;
  name: string;
  abbreviation?: string;
}

/**
 * Game mode information
 */
export interface GameMode {
  id: number;
  name: string;
}

/**
 * Company information
 */
export interface GameCompany {
  id: number;
  name: string;
  isDeveloper: boolean;
  isPublisher: boolean;
  isPorting: boolean;
  isSupporting: boolean;
  logo?: {
    imageId: string;
    url: string;
  };
  websites?: {
    category: string;
    url: string;
  }[];
}

/**
 * Screenshot information
 */
export interface GameScreenshot {
  id: number;
  imageId: string;
  url: string;
  urlHuge?: string;
  url720p?: string;
}

/**
 * Artwork information
 */
export interface GameArtwork {
  id: number;
  imageId: string;
  url: string;
  url720p?: string;
  url1080p?: string;
}

/**
 * Video information
 */
export interface GameVideo {
  id: number;
  name: string;
  videoId: string;
  youtubeUrl: string;
  thumbnailUrl: string;
}

/**
 * Similar game information
 */
export interface SimilarGame {
  id: number;
  name: string;
  slug: string;
  cover?: {
    imageId: string;
    url: string;
  };
}

/**
 * Player perspective information
 */
export interface PlayerPerspective {
  id: number;
  name: string;
}

/**
 * Multiplayer mode information
 */
export interface MultiplayerMode {
  campaignCoop: boolean;
  dropIn: boolean;
  lanCoop: boolean;
  offlineCoop: boolean;
  onlineCoop: boolean;
  onlineCoopMax?: number;
  onlineMax?: number;
  splitscreen: boolean;
}

/**
 * Complete game data from IGDB
 */
export interface GameData {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  storyline?: string;
  url?: string;
  cover?: GameCover;
  genres?: GameGenre[];
  themes?: GameTheme[];
  platforms?: GamePlatform[];
  gameModes?: GameMode[];
  companies?: GameCompany[];
  developers?: GameCompany[];
  publishers?: GameCompany[];
  screenshots?: GameScreenshot[];
  artworks?: GameArtwork[];
  videos?: GameVideo[];
  websites?: { category: string; url: string }[];
  firstReleaseDate?: string;
  releaseYear?: number;
  rating?: number;
  ratingCount?: number;
  criticRating?: number;
  criticRatingCount?: number;
  totalRating?: number;
  totalRatingCount?: number;
  similarGames?: SimilarGame[];
  playerPerspectives?: PlayerPerspective[];
  multiplayerModes?: MultiplayerMode[];
}

/**
 * Service to fetch game data from IGDB proxy API
 */
@Injectable({
  providedIn: 'root',
})
export class IgdbService {
  private utilities = inject(UtilitiesService);

  // API endpoints for different regions
  private readonly apiEndpoints = [
    'https://proxy.af.nostria.app/api/IGDB',
    'https://proxy.us.nostria.app/api/IGDB',
    'https://proxy.eu.nostria.app/api/IGDB',
  ];

  // Cache for game data
  private gameCache = new Map<number, GameData>();

  // Currently loading game IDs
  private loadingGames = signal(new Set<number>());

  /**
   * Extract IGDB ID from stream tags
   * Tags can be like: "igdb:294041"
   */
  extractIgdbId(tags: string[][]): number | null {
    for (const tag of tags) {
      if (tag[0] === 't' && tag[1]?.startsWith('igdb:')) {
        const id = parseInt(tag[1].substring(5), 10);
        if (!isNaN(id)) {
          return id;
        }
      }
    }
    return null;
  }

  /**
   * Check if game data is cached
   */
  isGameCached(gameId: number): boolean {
    return this.gameCache.has(gameId);
  }

  /**
   * Get cached game data
   */
  getCachedGame(gameId: number): GameData | undefined {
    return this.gameCache.get(gameId);
  }

  /**
   * Check if a game is currently loading
   */
  isLoading(gameId: number): boolean {
    return this.loadingGames().has(gameId);
  }

  /**
   * Fetch game data from IGDB proxy API
   * Tries multiple endpoints for redundancy
   */
  async fetchGameData(gameId: number): Promise<GameData | null> {
    // Return cached data if available
    if (this.gameCache.has(gameId)) {
      return this.gameCache.get(gameId)!;
    }

    // Check if already loading
    if (this.isLoading(gameId)) {
      // Wait for existing request
      return this.waitForGame(gameId);
    }

    // Mark as loading
    this.loadingGames.update(set => {
      const newSet = new Set(set);
      newSet.add(gameId);
      return newSet;
    });

    try {
      // Shuffle endpoints to distribute load
      const endpoints = this.shuffleArray([...this.apiEndpoints]);

      for (const endpoint of endpoints) {
        try {
          const url = `${endpoint}?action=get&id=${gameId}`;
          const response = await fetch(url);

          if (response.ok) {
            const data = await response.json() as GameData;
            this.gameCache.set(gameId, data);
            return data;
          }
        } catch {
          // Try next endpoint
          continue;
        }
      }

      return null;
    } finally {
      // Remove from loading
      this.loadingGames.update(set => {
        const newSet = new Set(set);
        newSet.delete(gameId);
        return newSet;
      });
    }
  }

  /**
   * Wait for a game that's currently being loaded
   */
  private async waitForGame(gameId: number, maxWait = 10000): Promise<GameData | null> {
    const startTime = Date.now();
    while (this.isLoading(gameId) && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.gameCache.get(gameId) ?? null;
  }

  /**
   * Shuffle array for load balancing
   */
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Get the best cover URL for display
   */
  getBestCoverUrl(game: GameData | null | undefined, size: 'small' | 'medium' | 'large' = 'medium'): string | null {
    if (!game?.cover) return null;

    switch (size) {
      case 'small':
        return game.cover.urlSmall || game.cover.url;
      case 'large':
        return game.cover.url720p || game.cover.url;
      default:
        return game.cover.url;
    }
  }

  /**
   * Get platform abbreviations as a comma-separated string
   */
  getPlatformString(game: GameData | null | undefined): string {
    if (!game?.platforms) return '';
    return game.platforms
      .map(p => p.abbreviation || p.name)
      .slice(0, 4) // Limit to 4 platforms
      .join(', ');
  }

  /**
   * Get genre names as a comma-separated string
   */
  getGenreString(game: GameData | null | undefined): string {
    if (!game?.genres) return '';
    return game.genres
      .map(g => g.name)
      .slice(0, 3) // Limit to 3 genres
      .join(', ');
  }

  /**
   * Get developer names
   */
  getDeveloperString(game: GameData | null | undefined): string {
    if (!game?.developers) return '';
    return game.developers
      .map(d => d.name)
      .slice(0, 2) // Limit to 2 developers
      .join(', ');
  }

  /**
   * Get publisher names
   */
  getPublisherString(game: GameData | null | undefined): string {
    if (!game?.publishers) return '';
    return game.publishers
      .map(p => p.name)
      .slice(0, 2) // Limit to 2 publishers
      .join(', ');
  }

  /**
   * Format rating for display
   */
  formatRating(rating: number | undefined): string {
    if (!rating) return '';
    return `${Math.round(rating)}%`;
  }
}
