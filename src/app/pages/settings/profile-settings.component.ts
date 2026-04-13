import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LayoutService } from '../../services/layout.service';
import { RightPanelService } from '../../services/right-panel.service';
import { SettingsLinkCardComponent } from './sections/settings-link-card.component';

@Component({
  selector: 'app-profile-settings',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, SettingsLinkCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back" i18n-matTooltip="@@common.back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@settings.sections.profile">Profile</h2>
      <span class="panel-header-spacer"></span>
    </div>

    <div class="content-medium">
      <div class="settings-link-list">
        <app-settings-link-card
          icon="edit"
          i18n-title="@@settings.profile.edit"
          title="Edit Profile"
          i18n-description="@@settings.profile.edit.description"
          description="Update your name, picture, bio, and profile links"
          (activated)="openProfileEdit()"
        />
      </div>
    </div>
  `,
  styles: [`
    .settings-link-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 0;
    }
  `],
})
export class ProfileSettingsComponent {
  private readonly rightPanel = inject(RightPanelService);
  private readonly layout = inject(LayoutService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  openProfileEdit(): void {
    this.layout.openProfileEdit();
  }
}