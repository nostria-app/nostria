import { Component, inject, OnInit } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { MatListModule } from '@angular/material/list';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { SetUsernameDialogComponent } from './set-username-dialog/set-username-dialog.component';

@Component({
  selector: 'app-premium',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatExpansionModule,
    MatDividerModule,
    MatDialogModule,
    RouterLink,
  ],
  templateUrl: './premium.component.html',
  styleUrl: './premium.component.scss',
})
export class PremiumComponent implements OnInit {
  app = inject(ApplicationService);
  accountState = inject(AccountStateService);
  environment = environment;
  private dialog = inject(MatDialog);

  async ngOnInit() {
    // Refresh subscription status when the premium page is opened
    try {
      await this.accountState.refreshSubscription();
    } catch (error) {
      console.error('Failed to refresh subscription on premium page load:', error);
    }
  }

  openSetUsernameDialog(): void {
    const dialogRef = this.dialog.open(SetUsernameDialogComponent, {
      width: '500px',
      disableClose: false,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Username was set successfully, refresh handled by dialog
        console.log('Username set successfully');
      }
    });
  }
}
