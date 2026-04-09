import { Component, inject, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatRippleModule } from '@angular/material/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { CreateOptionsSheetComponent } from '../../components/create-options-sheet/create-options-sheet.component';
import { AccountStateService } from '../../services/account-state.service';
import { ThemeService } from '../../services/theme.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';
import { InstallService } from '../../services/install.service';
import { MaterialCustomDialogComponent } from '../../components/material-custom-dialog/material-custom-dialog.component';
import { WhatsNewDialogComponent } from '../../components/whats-new-dialog/whats-new-dialog.component';
import { Introduction } from '../../components/introduction/introduction';
import { MediaPlayerService } from '../../services/media-player.service';
import { MessagingService } from '../../services/messaging.service';

/**
 * Home component - Serves as the landing page and navigation hub.
 * When user navigates to home (/), the feeds panel is shown in the left column.
 * This component shows detailed navigation and discovery options in the right panel/main view.
 * 
 * Note: The TwoColumnLayoutService automatically sets wide mode (1400px) for the home route
 * in its handleRouteChange method, so we don't need to manage it here.
 */
@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    RouterLink,
    MatBottomSheetModule,
    MatRippleModule,
    MatBadgeModule,
    Introduction,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  app = inject(ApplicationService);
  twoColumnLayout = inject(TwoColumnLayoutService);
  account = inject(AccountStateService);
  theme = inject(ThemeService);
  layout = inject(LayoutService);
  settings = inject(SettingsService);
  installService = inject(InstallService);
  media = inject(MediaPlayerService);
  private messaging = inject(MessagingService);
  private bottomSheet = inject(MatBottomSheet);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  /**
   * Unread messages count for the Messages tile badge.
   * Returns the count when > 0, or null to hide the badge.
   */
  unreadMessagesCount = computed(() => {
    const count = this.messaging.unreadBadgeCount();
    return count > 0 ? count : null;
  });

  /**
   * Greeting based on time of day - signal for better change detection.
   * Initialized once when component is created.
   */
  greeting = signal(this.computeGreeting());

  private computeGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return $localize`:@@home.greeting.morning:Good Morning`;
    if (hour < 18) return $localize`:@@home.greeting.afternoon:Good Afternoon`;
    return $localize`:@@home.greeting.evening:Good Evening`;
  }

  /**
   * Open the create content menu
   */
  openCreateMenu(): void {
    this.bottomSheet.open(CreateOptionsSheetComponent, {
      panelClass: 'glass-bottom-sheet',
    });
  }

  openCommandPalette(): void {
    this.layout.openCommandPalette();
  }

  openAiSettingsPanel(event?: Event): void {
    event?.preventDefault();
    this.layout.navigateToRightPanel('ai/settings');
  }

  openPublishCustomEvent(): void {
    this.layout.openPublishCustomEvent();
  }

  openInstallDialog(): void {
    this.installService.openInstallDialog();
  }

  openWhatsNewDialog(): void {
    this.dialog.open(WhatsNewDialogComponent, {
      panelClass: ['material-custom-dialog-panel'],
    });
  }

  openTestDialog(): void {
    this.dialog.open(MaterialCustomDialogComponent, {
      width: '680px',
      maxWidth: '92vw',
      panelClass: 'material-custom-dialog-panel',
      data: {
        icon: 'responsive_layout',
        title: $localize`:@@home.test-dialog.title:Material Dialog Shell`,
        message: $localize`:@@home.test-dialog.message:This dialog uses Angular Material for the overlay and accessibility behavior, but the layout and mobile treatment are styled to feel like Nostria's custom dialog component.`,
        primaryActionText: $localize`:@@home.test-dialog.primary-action:Looks good`,
        secondaryActionText: $localize`:@@home.test-dialog.secondary-action:Close`,
        details: [
          {
            icon: 'phone_iphone',
            title: $localize`:@@home.test-dialog.detail.mobile-title:Mobile-first layout`,
            description: $localize`:@@home.test-dialog.detail.mobile-description:On smaller screens the dialog expands edge-to-edge, removes rounded corners, and keeps the action row anchored at the bottom.`,
          },
          {
            icon: 'style',
            title: $localize`:@@home.test-dialog.detail.style-title:Custom shell styling`,
            description: $localize`:@@home.test-dialog.detail.style-description:The header, spacing, surface tones, and button treatment follow the app's custom dialog language instead of the stock Material appearance.`,
          },
          {
            icon: 'verified_user',
            title: $localize`:@@home.test-dialog.detail.material-title:Material dialog behavior`,
            description: $localize`:@@home.test-dialog.detail.material-description:Focus handling, overlay stacking, escape handling, and close interactions still come from Angular Material.`,
          },
        ],
      },
    });
  }

  shouldShowInstallOption(): boolean {
    return this.installService.shouldShowInstallOption();
  }

  isAiEnabled(): boolean {
    return this.settings.settings().aiEnabled ?? false;
  }

  openShoutouts(): void {
    this.layout.openShoutouts();
  }

  openWelcomeWizard(): void {
    this.layout.showWelcomeDialog();
  }

  openTermsOfUse(): void {
    this.layout.openTermsOfUse();
  }

  async openMediaPlayer(): Promise<void> {
    if (!this.media.hasQueue()) {
      this.snackBar.open($localize`:@@home.media-player.empty-queue:Media queue is empty`, 'Close', {
        duration: 2500,
      });
      return;
    }

    this.layout.showMediaPlayer.set(true);
    await this.media.resume();
  }
}
