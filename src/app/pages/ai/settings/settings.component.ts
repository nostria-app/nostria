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

interface ChoiceOption {
  value: string;
  label: string;
}

interface AiCachedFileItem {
  key: string;
  name: string;
  mimeType: string;
  bytes: number;
  kind: 'image' | 'video' | 'file';
  previewUrl?: string;
}

const STANDARD_PROMPTS_SOURCE_URL = 'https://raw.githubusercontent.com/mlc-ai/web-llm-chat/223895cb1be677504cf26904df5e3b0b451ba992/public/prompts.json';
const STANDARD_PROMPTS_SOURCE_LABEL = 'MLC web-llm-chat prompts.json';
const STANDARD_PROMPTS_BLOCKLIST = /(Gaslighter|AI Trying to Escape the Box|Unconstrained AI model DAN|\bDAN\b|Lunatic|Plagiarism Checker)/i;
const AI_BROWSER_CACHE = 'nostria-ai';

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
  readonly xAiImageAspectRatioOptions: ChoiceOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1:1', label: '1:1 Square' },
    { value: '16:9', label: '16:9 Landscape' },
    { value: '9:16', label: '9:16 Portrait' },
    { value: '4:3', label: '4:3 Landscape' },
    { value: '3:4', label: '3:4 Portrait' },
    { value: '3:2', label: '3:2 Photo' },
    { value: '2:3', label: '2:3 Portrait Photo' },
    { value: '2:1', label: '2:1 Banner' },
    { value: '1:2', label: '1:2 Tall Banner' },
    { value: '19.5:9', label: '19.5:9 Phone' },
    { value: '9:19.5', label: '9:19.5 Tall Phone' },
    { value: '20:9', label: '20:9 Ultra-wide' },
    { value: '9:20', label: '9:20 Tall Ultra-wide' },
  ];
  readonly xAiImageResolutionOptions: ChoiceOption[] = [
    { value: '1k', label: '1k' },
    { value: '2k', label: '2k' },
  ];
  readonly xAiImageCountOptions: ChoiceOption[] = Array.from({ length: 10 }, (_, index) => ({
    value: String(index + 1),
    label: String(index + 1),
  }));
  readonly xAiVideoAspectRatioOptions: ChoiceOption[] = [
    { value: '1:1', label: '1:1 Square' },
    { value: '16:9', label: '16:9 Landscape' },
    { value: '9:16', label: '9:16 Portrait' },
    { value: '4:3', label: '4:3 Landscape' },
    { value: '3:4', label: '3:4 Portrait' },
    { value: '3:2', label: '3:2 Photo' },
    { value: '2:3', label: '2:3 Portrait Photo' },
  ];
  readonly xAiVideoResolutionOptions: ChoiceOption[] = [
    { value: '480p', label: '480p' },
    { value: '720p', label: '720p' },
  ];
  readonly xAiVideoDurationOptions: ChoiceOption[] = Array.from({ length: 15 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1} sec`,
  }));
  readonly modelStorageReport = signal<AiModelStorageReport | null>(null);
  readonly modelStorageLoading = signal(false);
  readonly aiCacheFiles = signal<AiCachedFileItem[]>([]);
  readonly aiCacheLoading = signal(false);
  readonly clearingAiCacheKeys = signal<Set<string>>(new Set());
  readonly clearingAllAiCacheFiles = signal(false);
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
  readonly aiCacheSummary = computed(() => {
    const files = this.aiCacheFiles();
    return {
      count: files.length,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    };
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
    void this.refreshAiCacheFiles();
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
    this.releaseAiCachePreviewUrls(this.aiCacheFiles());

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

  updateXAiImageAspectRatio(aspectRatio: string): void {
    this.aiService.updateCloudSettings({ xaiImageAspectRatio: aspectRatio });
  }

  updateXAiImageResolution(resolution: string): void {
    this.aiService.updateCloudSettings({ xaiImageResolution: resolution });
  }

  updateXAiImageCount(count: string | number): void {
    this.aiService.updateCloudSettings({ xaiImageCount: Number(count) });
  }

  updateXAiVideoModel(model: string): void {
    this.aiService.updateCloudSettings({ xaiVideoModel: model });
  }

  updateXAiVideoDuration(duration: string | number): void {
    this.aiService.updateCloudSettings({ xaiVideoDuration: Number(duration) });
  }

  updateXAiVideoAspectRatio(aspectRatio: string): void {
    this.aiService.updateCloudSettings({ xaiVideoAspectRatio: aspectRatio });
  }

  updateXAiVideoResolution(resolution: string): void {
    this.aiService.updateCloudSettings({ xaiVideoResolution: resolution });
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

  async refreshAiCacheFiles(): Promise<void> {
    this.aiCacheLoading.set(true);

    try {
      if (typeof caches === 'undefined') {
        this.replaceAiCacheFiles([]);
        return;
      }

      const cache = await caches.open(AI_BROWSER_CACHE);
      const requests = await cache.keys();
      const files = await Promise.all(requests.map(async request => {
        const response = await cache.match(request);
        if (!response) {
          return null;
        }

        const blob = await response.clone().blob();
        return {
          key: request.url,
          name: this.resolveAiCacheFileName(request.url, response),
          mimeType: response.headers.get('content-type') || blob.type || 'Unknown type',
          bytes: blob.size,
          kind: this.resolveAiCacheFileKind(response.headers.get('content-type') || blob.type || ''),
          previewUrl: this.supportsAiCachePreview(response.headers.get('content-type') || blob.type || '')
            ? URL.createObjectURL(blob)
            : undefined,
        } satisfies AiCachedFileItem;
      }));

      const resolvedFiles = files.filter((file): file is NonNullable<typeof file> => file !== null);
      resolvedFiles.sort((left, right) => left.name.localeCompare(right.name));
      this.replaceAiCacheFiles(resolvedFiles);
    } catch (error) {
      console.error('Failed to read AI cache files', error);
      this.snackBar.open('Could not read cached AI files.', 'Dismiss', { duration: 3500 });
    } finally {
      this.aiCacheLoading.set(false);
    }
  }

  async deleteAiCacheFile(file: AiCachedFileItem): Promise<void> {
    this.clearingAiCacheKeys.update(keys => new Set(keys).add(file.key));

    try {
      if (typeof caches === 'undefined') {
        return;
      }

      const cache = await caches.open(AI_BROWSER_CACHE);
      const deleted = await cache.delete(file.key);
      if (!deleted) {
        this.snackBar.open(`Could not remove ${file.name} from the AI cache.`, 'Dismiss', { duration: 3500 });
        return;
      }

      this.snackBar.open(`${file.name} removed from the AI cache.`, 'Dismiss', { duration: 2800 });
      await this.refreshAiCacheFiles();
    } finally {
      this.clearingAiCacheKeys.update(keys => {
        const next = new Set(keys);
        next.delete(file.key);
        return next;
      });
    }
  }

  async clearAllAiCache(): Promise<void> {
    this.clearingAllAiCacheFiles.set(true);

    try {
      if (typeof caches === 'undefined') {
        this.replaceAiCacheFiles([]);
        return;
      }

      const cache = await caches.open(AI_BROWSER_CACHE);
      const requests = await cache.keys();
      await Promise.all(requests.map(request => cache.delete(request)));
      this.snackBar.open('All cached AI files removed from browser storage.', 'Dismiss', { duration: 3200 });
      await this.refreshAiCacheFiles();
    } catch (error) {
      console.error('Failed to clear AI cache files', error);
      this.snackBar.open('Could not clear cached AI files.', 'Dismiss', { duration: 3500 });
    } finally {
      this.clearingAllAiCacheFiles.set(false);
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

  isClearingAiCacheFile(cacheKey: string): boolean {
    return this.clearingAiCacheKeys().has(cacheKey);
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

  private resolveAiCacheFileName(cacheKey: string, response: Response): string {
    const headerName = response.headers.get('x-nostria-file-name');
    if (headerName?.trim()) {
      return headerName.trim();
    }

    try {
      const url = new URL(cacheKey);
      const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
      if (lastSegment) {
        return decodeURIComponent(lastSegment);
      }
    } catch {
      // Ignore malformed cache keys and fall back to the raw key.
    }

    return cacheKey;
  }

  private replaceAiCacheFiles(files: AiCachedFileItem[]): void {
    this.releaseAiCachePreviewUrls(this.aiCacheFiles());
    this.aiCacheFiles.set(files);
  }

  private releaseAiCachePreviewUrls(files: AiCachedFileItem[]): void {
    for (const file of files) {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    }
  }

  private resolveAiCacheFileKind(mimeType: string): 'image' | 'video' | 'file' {
    if (mimeType.startsWith('image/')) {
      return 'image';
    }

    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    return 'file';
  }

  private supportsAiCachePreview(mimeType: string): boolean {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/');
  }
}
