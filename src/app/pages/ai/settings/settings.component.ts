import { Component, inject } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../services/settings.service';
import { AiInfoDialogComponent } from '../../../components/ai-info-dialog/ai-info-dialog.component';

@Component({
  selector: 'app-ai-settings',
  imports: [
    MatCardModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    FormsModule
],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class AiSettingsComponent {
  settings = inject(SettingsService);
  dialog = inject(MatDialog);

  openInfoDialog() {
    this.dialog.open(AiInfoDialogComponent, {
      width: '500px',
    });
  }

  async toggleAi() {
    await this.settings.updateSettings({ aiEnabled: !this.settings.settings().aiEnabled });
  }

  async toggleFeature(feature: string) {
    const current = this.settings.settings();
    const update: Partial<import('../../../services/settings.service').UserSettings> = {};

    switch (feature) {
      case 'sentiment':
        update.aiSentimentEnabled = !current.aiSentimentEnabled;
        break;
      case 'translation':
        update.aiTranslationEnabled = !current.aiTranslationEnabled;
        break;
      case 'summarization':
        update.aiSummarizationEnabled = !current.aiSummarizationEnabled;
        break;
      case 'transcription':
        update.aiTranscriptionEnabled = !current.aiTranscriptionEnabled;
        break;
      case 'speech':
        update.aiSpeechEnabled = !current.aiSpeechEnabled;
        break;
    }

    await this.settings.updateSettings(update);
  }

  async updateVoice(voice: 'female' | 'male') {
    await this.settings.updateSettings({ aiVoice: voice });
  }
}
