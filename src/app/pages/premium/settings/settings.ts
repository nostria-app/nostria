import { Component, inject, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { AccountStateService } from '../../../services/account-state.service';
import { DatePipe } from '@angular/common';
import { SetUsernameDialogComponent, SetUsernameDialogData } from '../set-username-dialog/set-username-dialog.component';
import { RightPanelService } from '../../../services/right-panel.service';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-premium-settings',
  imports: [MatCardModule, MatListModule, MatButtonModule, MatIconModule, MatTooltipModule, RouterLink, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class PremiumSettings implements OnInit {
  accountState = inject(AccountStateService);
  private dialog = inject(MatDialog);
  private rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  async ngOnInit() {
    // Refresh subscription status when the premium settings page is opened
    try {
      await this.accountState.refreshSubscription();
    } catch (error) {
      console.error('Failed to refresh subscription on premium settings page load:', error);
    }
  }

  openSetUsernameDialog(): void {
    const currentUsername = this.accountState.subscription()?.username;

    const dialogRef = this.dialog.open<SetUsernameDialogComponent, SetUsernameDialogData>(
      SetUsernameDialogComponent,
      {
        width: '500px',
        disableClose: false,
        data: { currentUsername },
      }
    );

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Username was set/changed successfully, refresh subscription to show new username
        console.log('Username operation completed successfully, refreshing subscription');
        this.accountState.refreshSubscription().catch(error => {
          console.error('Failed to refresh subscription after username update:', error);
        });
      }
    });
  }
}
