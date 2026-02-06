import { Component, inject } from '@angular/core';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-ai-info-dialog',
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, FormsModule],
  templateUrl: './ai-info-dialog.component.html',
  styleUrl: './ai-info-dialog.component.scss',
})
export class AiInfoDialogComponent {
  private dialogRef = inject(MatDialogRef<AiInfoDialogComponent>);
  private settingsService = inject(SettingsService);

  disableAi = false;

  constructor() {
    // Initialize checkbox state based on current settings (inverted)
    this.disableAi = !this.settingsService.settings().aiEnabled;
  }

  close() {
    if (this.disableAi) {
      this.settingsService.updateSettings({ aiEnabled: false });
      this.dialogRef.close(false);
    } else {
      // Only re-enable if it was previously disabled and user unchecked the box
      // But usually this dialog is informative.
      // If user explicitly unchecks "Disable AI", we should enable it.
      this.settingsService.updateSettings({ aiEnabled: true });
      this.dialogRef.close(true);
    }
  }
}
