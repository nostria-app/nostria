import { Component, inject, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AccountStateService } from '../../../services/account-state.service';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-premium-settings',
  imports: [MatCardModule, MatListModule, MatButtonModule, MatIconModule, RouterLink, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class PremiumSettings implements OnInit {
  accountState = inject(AccountStateService);

  async ngOnInit() {
    // Refresh subscription status when the premium settings page is opened
    try {
      await this.accountState.refreshSubscription();
    } catch (error) {
      console.error('Failed to refresh subscription on premium settings page load:', error);
    }
  }
}
