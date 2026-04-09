import { Component, inject, ChangeDetectionStrategy, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../services/settings.service';
import { AiInfoDialogComponent } from '../../../components/ai-info-dialog/ai-info-dialog.component';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ai-settings',
  imports: [
    MatCardModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    FormsModule
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  host: { class: 'panel-with-sticky-header' },
})
export class AiSettingsComponent implements OnInit, OnDestroy {
  readonly settings = inject(SettingsService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly panelActions = inject(PanelActionsService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly panelNav = inject(PanelNavigationService);

  readonly isInRightPanel = this.route.outlet === 'right';

  ngOnInit(): void {
    if (this.isInRightPanel) {
      this.panelActions.setRightPanelActions([
        {
          id: 'ai-settings-info',
          icon: 'info',
          label: $localize`:@@ai.settings.about:About local AI`,
          tooltip: $localize`:@@ai.settings.about.tooltip:About local AI`,
          action: () => this.openInfoDialog(),
        },
      ]);
    }
  }

  ngOnDestroy(): void {
    if (this.isInRightPanel) {
      this.panelActions.clearRightPanelActions();
    }
  }

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

  goBack(): void {
    if (this.isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }

    this.rightPanel.goBack();
  }
}
