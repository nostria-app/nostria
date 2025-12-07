import { Component, input, signal, effect, inject, untracked, computed } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { IgdbService, GameData } from '../../services/igdb.service';

@Component({
  selector: 'app-game-hover-card',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatChipsModule,
  ],
  templateUrl: './game-hover-card.component.html',
  styleUrl: './game-hover-card.component.scss',
})
export class GameHoverCardComponent {
  gameId = input.required<number>();

  private igdbService = inject(IgdbService);

  isLoading = signal<boolean>(true);
  gameData = signal<GameData | null>(null);
  error = signal<string | null>(null);

  // Computed properties for display
  coverUrl = computed(() => this.igdbService.getBestCoverUrl(this.gameData(), 'large'));
  genres = computed(() => this.igdbService.getGenreString(this.gameData()));
  platforms = computed(() => this.igdbService.getPlatformString(this.gameData()));
  developers = computed(() => this.igdbService.getDeveloperString(this.gameData()));
  publishers = computed(() => this.igdbService.getPublisherString(this.gameData()));
  rating = computed(() => {
    const game = this.gameData();
    if (!game?.rating) return null;
    return Math.round(game.rating);
  });
  releaseYear = computed(() => this.gameData()?.releaseYear);

  constructor() {
    effect(() => {
      const id = this.gameId();

      if (id) {
        untracked(() => {
          this.loadGameData(id);
        });
      }
    });
  }

  private async loadGameData(gameId: number): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const data = await this.igdbService.fetchGameData(gameId);

      if (data) {
        this.gameData.set(data);
      } else {
        this.error.set('Game not found');
      }
    } catch (err) {
      console.error('Error loading game data:', err);
      this.error.set('Failed to load game');
    } finally {
      this.isLoading.set(false);
    }
  }

  openIgdbPage(): void {
    const game = this.gameData();
    if (game?.url) {
      window.open(game.url, '_blank', 'noopener,noreferrer');
    }
  }
}
