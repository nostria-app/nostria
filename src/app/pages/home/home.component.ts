import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatRippleModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { CreateOptionsSheetComponent } from '../../components/create-options-sheet/create-options-sheet.component';
import { AccountStateService } from '../../services/account-state.service';
import { ThemeService } from '../../services/theme.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';
import { InstallService } from '../../services/install.service';
import { WhatsNewDialogComponent } from '../../components/whats-new-dialog/whats-new-dialog.component';
import { Introduction } from '../../components/introduction/introduction';

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
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    RouterLink,
    MatBottomSheetModule,
    MatRippleModule,
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
  private bottomSheet = inject(MatBottomSheet);
  private dialog = inject(MatDialog);

  /**
   * Open the create content menu
   */
  openCreateMenu(): void {
    this.bottomSheet.open(CreateOptionsSheetComponent, {
      panelClass: 'glass-bottom-sheet',
    });
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return $localize`:@@home.greeting.morning:Good Morning`;
    if (hour < 18) return $localize`:@@home.greeting.afternoon:Good Afternoon`;
    return $localize`:@@home.greeting.evening:Good Evening`;
  }

  openCommandPalette(): void {
    this.layout.openCommandPalette();
  }

  openPublishCustomEvent(): void {
    this.layout.openPublishCustomEvent();
  }

  openInstallDialog(): void {
    this.installService.openInstallDialog();
  }

  openWhatsNewDialog(): void {
    this.dialog.open(WhatsNewDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: 'whats-new-dialog-container',
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
}
