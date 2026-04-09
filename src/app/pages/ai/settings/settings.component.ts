import { Component, computed, inject, ChangeDetectionStrategy, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../services/settings.service';
import { AiCloudProvider, AiManagedModelStatus, AiModelStorageReport, AiService } from '../../../services/ai.service';
import { AiInfoDialogComponent } from '../../../components/ai-info-dialog/ai-info-dialog.component';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';

interface StandardPromptItem {
  title: string;
  prompt: string;
  preview: string;
}

const STANDARD_PROMPTS_SOURCE_URL = 'https://raw.githubusercontent.com/mlc-ai/web-llm-chat/223895cb1be677504cf26904df5e3b0b451ba992/public/prompts.json';
const STANDARD_PROMPTS_SOURCE_LABEL = 'MLC web-llm-chat prompts.json';
const STANDARD_PROMPTS_BLOCKLIST = /(Gaslighter|AI Trying to Escape the Box|Unconstrained AI model DAN|\bDAN\b|Lunatic|Plagiarism Checker)/i;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ai-settings',
  imports: [
    MatCardModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  host: { class: 'panel-with-sticky-header' },
})
export class AiSettingsComponent implements OnInit, OnDestroy {
  readonly settings = inject(SettingsService);
  readonly aiService = inject(AiService);
  private readonly customDialog = inject(CustomDialogService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly panelActions = inject(PanelActionsService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly panelNav = inject(PanelNavigationService);

  readonly isInRightPanel = this.route.outlet === 'right';
  readonly cloudProviders: AiCloudProvider[] = ['xai', 'openai'];
  readonly modelStorageReport = signal<AiModelStorageReport | null>(null);
  readonly modelStorageLoading = signal(false);
  readonly standardPromptQuery = signal('');
  readonly standardPrompts = signal<StandardPromptItem[]>([]);
  readonly standardPromptsLoading = signal(false);
  readonly standardPromptsError = signal('');
  readonly clearingModelIds = signal<Set<string>>(new Set());
  readonly clearingAllModels = signal(false);
  readonly modelStorageSummary = computed(() => {
    const report = this.modelStorageReport();
    if (!report) {
      return null;
    }

    return {
      cachedCount: report.models.filter(model => model.cached || model.bytes > 0).length,
      totalCount: report.models.length,
      totalBytes: report.totalBytes,
      quotaBytes: report.storageQuotaBytes,
      usageBytes: report.storageUsageBytes,
    };
  });
  readonly filteredStandardPrompts = computed(() => {
    const query = this.standardPromptQuery().trim().toLowerCase();
    if (!query) {
      return this.standardPrompts();
    }

    return this.standardPrompts().filter(prompt => prompt.title.toLowerCase().includes(query) || prompt.prompt.toLowerCase().includes(query));
  });

  openAiApiKey = '';
  xAiApiKey = '';
  showOpenAiApiKey = false;
  showXAiApiKey = false;

  constructor() {
    const cloudSettings = this.aiService.cloudSettings();
    this.openAiApiKey = cloudSettings.openaiApiKey ?? '';
    this.xAiApiKey = cloudSettings.xaiApiKey ?? '';
  }

  ngOnInit(): void {
    void this.refreshModelStorage();
    void this.loadStandardPrompts();

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
    this.customDialog.open(AiInfoDialogComponent, {
      width: 'min(680px, calc(100vw - 24px))',
      maxWidth: 'calc(100vw - 24px)',
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

  providerLabel(provider: AiCloudProvider): string {
    return this.aiService.getProviderLabel(provider);
  }

  providerConfigured(provider: AiCloudProvider): boolean {
    return this.aiService.hasCloudApiKey(provider);
  }

  toggleApiKeyVisibility(provider: AiCloudProvider): void {
    if (provider === 'openai') {
      this.showOpenAiApiKey = !this.showOpenAiApiKey;
      return;
    }

    this.showXAiApiKey = !this.showXAiApiKey;
  }

  saveApiKey(provider: AiCloudProvider): void {
    const value = provider === 'openai' ? this.openAiApiKey : this.xAiApiKey;
    this.aiService.setCloudApiKey(provider, value);
    this.snackBar.open(`${this.providerLabel(provider)} API key saved on this device.`, 'Dismiss', { duration: 3500 });
  }

  clearApiKey(provider: AiCloudProvider): void {
    this.aiService.clearCloudApiKey(provider);

    if (provider === 'openai') {
      this.openAiApiKey = '';
      this.showOpenAiApiKey = false;
    } else {
      this.xAiApiKey = '';
      this.showXAiApiKey = false;
    }

    this.snackBar.open(`${this.providerLabel(provider)} API key removed from this device.`, 'Dismiss', { duration: 3500 });
  }

  updatePreferredImageProvider(provider: AiCloudProvider): void {
    this.aiService.updateCloudSettings({ preferredImageProvider: provider });
  }

  updateImageModel(provider: AiCloudProvider, model: string): void {
    if (provider === 'openai') {
      this.aiService.updateCloudSettings({ openaiImageModel: model });
      return;
    }

    this.aiService.updateCloudSettings({ xaiImageModel: model });
  }

  updateChatModel(provider: AiCloudProvider, model: string): void {
    if (provider === 'openai') {
      this.aiService.updateCloudSettings({ openaiChatModel: model });
      return;
    }

    this.aiService.updateCloudSettings({ xaiChatModel: model });
  }

  async refreshModelStorage(): Promise<void> {
    this.modelStorageLoading.set(true);

    try {
      this.modelStorageReport.set(await this.aiService.getModelStorageReport());
    } catch (error) {
      console.error('Failed to refresh AI model storage report', error);
      this.snackBar.open('Could not read downloaded model storage.', 'Dismiss', { duration: 3500 });
    } finally {
      this.modelStorageLoading.set(false);
    }
  }

  async clearModel(model: AiManagedModelStatus): Promise<void> {
    this.clearingModelIds.update(ids => new Set(ids).add(model.id));

    try {
      const success = await this.aiService.deleteModelFromCache(model.id);
      if (!success) {
        this.snackBar.open(`Could not remove ${model.name} from local storage.`, 'Dismiss', { duration: 3500 });
        return;
      }

      this.snackBar.open(`${model.name} removed from local storage.`, 'Dismiss', { duration: 2800 });
      await this.refreshModelStorage();
    } finally {
      this.clearingModelIds.update(ids => {
        const next = new Set(ids);
        next.delete(model.id);
        return next;
      });
    }
  }

  async clearAllModels(): Promise<void> {
    this.clearingAllModels.set(true);

    try {
      const success = await this.aiService.clearAllCache();
      if (!success) {
        this.snackBar.open('Could not clear downloaded models.', 'Dismiss', { duration: 3500 });
        return;
      }

      this.snackBar.open('All downloaded models removed from local storage.', 'Dismiss', { duration: 3200 });
      await this.refreshModelStorage();
    } finally {
      this.clearingAllModels.set(false);
    }
  }

  async loadStandardPrompts(): Promise<void> {
    this.standardPromptsLoading.set(true);
    this.standardPromptsError.set('');

    try {
      const response = await fetch(STANDARD_PROMPTS_SOURCE_URL, {
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Prompt library request failed with ${response.status}`);
      }

      const payload = await response.json() as { en?: unknown[] };
      this.standardPrompts.set(this.parseStandardPrompts(payload.en));
    } catch (error) {
      console.error('Failed to load AI standard prompts', error);
      this.standardPromptsError.set('Could not load the standard prompt library right now.');
    } finally {
      this.standardPromptsLoading.set(false);
    }
  }

  async useStandardPrompt(prompt: StandardPromptItem): Promise<void> {
    this.aiService.queueStandardPrompt({ title: prompt.title, prompt: prompt.prompt });

    if (this.isInRightPanel) {
      this.goBack();
    } else {
      await this.router.navigate(['/ai']);
    }
  }

  clearStandardPromptQuery(): void {
    this.standardPromptQuery.set('');
  }

  promptSourceUrl(): string {
    return STANDARD_PROMPTS_SOURCE_URL;
  }

  promptSourceLabel(): string {
    return STANDARD_PROMPTS_SOURCE_LABEL;
  }

  isClearingModel(modelId: string): boolean {
    return this.clearingModelIds().has(modelId);
  }

  formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) {
      return '0 B';
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${Math.round((bytes / 1024) * 10) / 10} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
    }

    return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GB`;
  }

  storageUsagePercent(): number | null {
    const summary = this.modelStorageSummary();
    if (!summary?.usageBytes || !summary.quotaBytes || summary.quotaBytes <= 0) {
      return null;
    }

    return Math.min(100, Math.round((summary.usageBytes / summary.quotaBytes) * 100));
  }

  goBack(): void {
    if (this.isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }

    this.rightPanel.goBack();
  }

  private parseStandardPrompts(source: unknown[] | undefined): StandardPromptItem[] {
    if (!Array.isArray(source)) {
      return [];
    }

    const titleCounts = new Map<string, number>();

    return source
      .filter((entry): entry is [string, string] => Array.isArray(entry)
        && entry.length >= 2
        && typeof entry[0] === 'string'
        && typeof entry[1] === 'string')
      .map(([rawTitle, rawPrompt]) => ({
        title: rawTitle.trim(),
        prompt: rawPrompt.trim(),
      }))
      .filter(entry => entry.title.length > 0 && entry.prompt.length > 0)
      .filter(entry => !STANDARD_PROMPTS_BLOCKLIST.test(entry.title) && !STANDARD_PROMPTS_BLOCKLIST.test(entry.prompt))
      .map(entry => {
        const count = (titleCounts.get(entry.title) ?? 0) + 1;
        titleCounts.set(entry.title, count);

        return {
          title: count > 1 ? `${entry.title} ${count}` : entry.title,
          prompt: entry.prompt,
          preview: this.buildPromptPreview(entry.prompt),
        };
      });
  }

  private buildPromptPreview(prompt: string): string {
    const compact = prompt.replace(/\s+/g, ' ').trim();
    if (compact.length <= 180) {
      return compact;
    }

    return `${compact.slice(0, 177).trimEnd()}...`;
  }
}
