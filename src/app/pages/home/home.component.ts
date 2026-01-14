import { Component, inject, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatRippleModule } from '@angular/material/core';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { CreateOptionsSheetComponent } from '../../components/create-options-sheet/create-options-sheet.component';
import { AccountStateService } from '../../services/account-state.service';
import { ThemeService } from '../../services/theme.service';
import { LayoutService } from '../../services/layout.service';

/**
 * Home component - Serves as the landing page and navigation hub.
 * When user navigates to home (/), the feeds panel is shown in the left column.
 * This component shows detailed navigation and discovery options in the right panel/main view.
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
    MatRippleModule
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnDestroy {
  app = inject(ApplicationService);
  twoColumnLayout = inject(TwoColumnLayoutService);
  account = inject(AccountStateService);
  theme = inject(ThemeService);
  layout = inject(LayoutService);
  private bottomSheet = inject(MatBottomSheet);

  constructor() {
    this.twoColumnLayout.setWideLeft();
  }

  ngOnDestroy() {
    this.twoColumnLayout.setSplitView();
  }

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
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }
}
