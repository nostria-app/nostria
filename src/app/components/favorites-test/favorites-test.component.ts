import { Component, inject } from '@angular/core';
import { FavoritesService } from '../../services/favorites.service';
import { AccountStateService } from '../../services/account-state.service';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-favorites-test',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule],
  template: `
    <mat-card>
      <mat-card-header>
        <mat-card-title>Favorites Test</mat-card-title>
        <mat-card-subtitle>Current Account: {{ currentAccount }}</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <p>Current favorites count: {{ currentFavorites.length }}</p>
        <ul>
          <li *ngFor="let favorite of currentFavorites">{{ favorite }}</li>
        </ul>
        
        <h3>Test Actions</h3>
        <button mat-button (click)="addTestFavorite()">Add Test Favorite</button>
        <button mat-button (click)="removeTestFavorite()">Remove Test Favorite</button>
        <button mat-button (click)="clearAllFavorites()">Clear All Favorites</button>
        
        <h3>Debug Info</h3>
        <p>Total favorites across all accounts: {{ totalFavorites }}</p>
        <p>Accounts with favorites: {{ accountsWithFavorites }}</p>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    mat-card {
      margin: 20px;
      max-width: 600px;
    }
    button {
      margin: 5px;
    }
  `]
})
export class FavoritesTestComponent {
  private favoritesService = inject(FavoritesService);
  private accountState = inject(AccountStateService);
  
  readonly testUserPubkey = 'test-user-pubkey-12345';
  
  get currentAccount() {
    return this.accountState.pubkey() || 'No account';
  }
  
  get currentFavorites() {
    return this.favoritesService.favorites();
  }
  
  get totalFavorites() {
    return this.favoritesService.getTotalFavoritesCount();
  }
  
  get accountsWithFavorites() {
    return this.favoritesService.getAccountsWithFavoritesCount();
  }
  
  addTestFavorite() {
    this.favoritesService.addFavorite(this.testUserPubkey);
  }
  
  removeTestFavorite() {
    this.favoritesService.removeFavorite(this.testUserPubkey);
  }
  
  clearAllFavorites() {
    this.favoritesService.clearCurrentAccountFavorites();
  }
}
