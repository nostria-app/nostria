import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { Event as NostrEvent } from 'nostr-tools';
import { CollectionSetsService, EmojiSet, EmojiEntry, EmojiItem, PreferredEmojiSet } from '../../../services/collection-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MediaPreviewDialogComponent } from '../../../components/media-preview-dialog/media-preview.component';
import { LayoutService } from '../../../services/layout.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { MediaService } from '../../../services/media.service';
import { NostrService } from '../../../services/nostr.service';
import { DatabaseService } from '../../../services/database.service';
import { PublishService } from '../../../services/publish.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { ClipboardService } from '../../../services/clipboard.service';
import { normalizeEmojiShortcode } from '../../../utils/emoji-shortcode';
import { DeleteEventService } from '../../../services/delete-event.service';

interface SuggestedEmojiPackDef {
  pubkey: string;
  identifier: string;
  title: string;
  relayHints?: string[];
}

interface SuggestedEmojiPack extends SuggestedEmojiPackDef {
  previewEmojis: { shortcode: string; url: string }[];
  isLoading: boolean;
  isInstalling: boolean;
  event: NostrEvent | null;
}

interface InstalledEmojiSetRef {
  aTagValue: string; // e.g. "30030:pubkey:d-tag"
  pubkey: string;
  identifier: string;
  title: string;
  emojiCount: number;
  previewEmojis: { shortcode: string; url: string }[];
}

interface EditableEmojiRow {
  id: string;
  shortcode: string;
  url: string;
  previewUrl: string | null;
  isUploading: boolean;
  uploadError: string | null;
}

@Component({
  selector: 'app-emoji-sets',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatChipsModule,
    MatMenuModule,
  ],
  templateUrl: './emoji-sets.component.html',
  styleUrl: './emoji-sets.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiSetsComponent implements OnInit, OnDestroy {
  private deleteEventService = inject(DeleteEventService);
  private collectionSetsService = inject(CollectionSetsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private emojiSetService = inject(EmojiSetService);
  private media = inject(MediaService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private publishService = inject(PublishService);
  private relayPool = inject(RelayPoolService);
  private clipboard = inject(ClipboardService);
  private nextEditingRowId = 0;

  // State
  isLoading = signal(false);
  emojiSets = signal<EmojiSet[]>([]);
  preferredEmojis = signal<PreferredEmojiSet[]>([]);
  installedSetsList = signal<InstalledEmojiSetRef[]>([]);
  copiedEmoji: string | null = null;

  // Editing state
  isChoosingSetType = signal(false);
  isEditingSet = signal(false);
  isEditingExisting = signal(false);
  editingSetId = signal('');
  editingSetName = signal('');
  editingSetRows = signal<EditableEmojiRow[]>([]);
  editingSetTags = signal<string[]>([]);
  newTagInput = signal('');
  isEmojiDropTargetActive = signal(false);

  hasMediaServers = computed(() => this.media.mediaServers().length > 0);
  isEditingGifCollection = computed(() => this.editingSetTags().includes('gifs'));

  // Suggested emoji packs
  suggestedPacks = signal<SuggestedEmojiPack[]>([]);

  readonly gifFfmpegCommand = 'for %i in (*.mp4) do ffmpeg -i "%i" -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "%~ni.gif"';

  // Suggested emoji pack definitions
  private readonly SUGGESTED_PACKS: SuggestedEmojiPackDef[] = [
    {
      pubkey: '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194',
      identifier: 'twitch',
      title: 'Twitch',
      relayHints: ['wss://nos.lol', 'wss://relay.damus.io'],
    },
    {
      pubkey: '01ddee289b1a2e90874ca3428a7a414764a6cad1abfaa985c201e7aada16d38c',
      identifier: 'Top collection',
      title: 'Top Collection',
      relayHints: ['wss://nos.lol', 'wss://relay.damus.io'],
    },
    {
      pubkey: '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194',
      identifier: 'GitHub',
      title: 'GitHub',
      relayHints: ['wss://lightning.red/', 'wss://theforest.nostr1.com/'],
    },
  ];

  // Compute installed set references for checking if a pack is already installed
  installedSetRefs = computed(() => {
    const refs = new Set<string>();
    for (const set of this.preferredEmojis()) {
      refs.add(set.identifier);
    }
    return refs;
  });

  async ngOnInit() {
    this.twoColumnLayout.setSplitView();
    await this.loadData();
    // Load suggested packs after main data
    this.loadSuggestedPacks();
  }

  ngOnDestroy(): void {
    this.releasePreviewUrls(this.editingSetRows());
  }

  async loadData() {
    this.isLoading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.error('No authenticated user');
        return;
      }

      // Load emoji sets (kind 30030)
      const sets = await this.collectionSetsService.getEmojiSets(pubkey);
      this.logger.info('Loaded emoji sets:', sets);
      this.emojiSets.set(sets);

      // Load preferred emojis (kind 10030)
      const preferred = await this.collectionSetsService.getPreferredEmojis(pubkey);
      this.logger.info('Loaded preferred emojis:', preferred);
      this.preferredEmojis.set(preferred);

      // Build installed sets list from kind 10030 a tags
      await this.loadInstalledSets(pubkey, preferred);
    } catch (error) {
      this.logger.error('Error loading emoji data:', error);
      this.snackBar.open('Error loading emoji data', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  startCreatingSet() {
    this.releasePreviewUrls(this.editingSetRows());
    this.isChoosingSetType.set(true);
    this.isEditingSet.set(false);
    this.isEditingExisting.set(false);
    this.editingSetRows.set([]);
    this.editingSetTags.set([]);
    this.newTagInput.set('');
    this.isEmojiDropTargetActive.set(false);
  }

  chooseNewSetType(type: 'emojis' | 'gifs') {
    this.isChoosingSetType.set(false);
    this.isEditingExisting.set(false);
    this.editingSetId.set(this.generateRandomId());
    this.editingSetName.set('');
    this.setEditingRows([this.createEmptyEmojiRow()]);
    this.editingSetTags.set(type === 'gifs' ? ['gifs'] : []);
    this.newTagInput.set('');
    this.isEmojiDropTargetActive.set(false);
    this.isEditingSet.set(true);
  }

  cancelSetTypeSelection() {
    this.isChoosingSetType.set(false);
  }

  private generateRandomId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    for (const byte of array) {
      result += chars[byte % chars.length];
    }
    return result;
  }

  regenerateId() {
    this.editingSetId.set(this.generateRandomId());
  }

  startEditingSet(set: EmojiSet) {
    this.isChoosingSetType.set(false);
    this.isEditingExisting.set(true);
    this.editingSetId.set(set.identifier);
    this.editingSetName.set(set.name);
    this.setEditingRows(
      set.emojis.length > 0
        ? set.emojis.map(emoji => this.createEmptyEmojiRow({
          shortcode: emoji.shortcode,
          url: emoji.url,
          previewUrl: emoji.url,
        }))
        : [this.createEmptyEmojiRow()]
    );
    this.editingSetTags.set([...set.tags]);
    this.newTagInput.set('');
    this.isEmojiDropTargetActive.set(false);
    this.isEditingSet.set(true);
  }

  cancelEditingSet() {
    this.releasePreviewUrls(this.editingSetRows());
    this.isChoosingSetType.set(false);
    this.isEditingSet.set(false);
    this.isEditingExisting.set(false);
    this.editingSetId.set('');
    this.editingSetName.set('');
    this.editingSetRows.set([]);
    this.editingSetTags.set([]);
    this.newTagInput.set('');
    this.isEmojiDropTargetActive.set(false);
  }

  addTag() {
    const tag = this.newTagInput().trim().toLowerCase();
    if (tag && !this.editingSetTags().includes(tag)) {
      this.editingSetTags.update(tags => [...tags, tag]);
    }
    this.newTagInput.set('');
  }

  removeTag(tag: string) {
    this.editingSetTags.update(tags => tags.filter(t => t !== tag));
  }

  onTagKeyPress(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addTag();
    }
  }

  async saveSetEdit() {
    const name = this.editingSetName().trim();
    const rows = this.editingSetRows().map(row => ({
      shortcode: normalizeEmojiShortcode(row.shortcode),
      url: row.url.trim(),
    }));

    if (!name) {
      this.snackBar.open('Please enter a set name', 'Close', { duration: 3000 });
      return;
    }

    const firstUploadingRow = this.editingSetRows().find(row => row.isUploading);
    if (firstUploadingRow) {
      this.snackBar.open('Please wait for uploads to finish before saving', 'Close', { duration: 3000 });
      return;
    }

    const emojis: EmojiEntry[] = [];
    for (const [index, row] of rows.entries()) {
      if (!row.shortcode && !row.url) {
        continue;
      }

      if (!row.shortcode || !row.url) {
        this.snackBar.open(`Row ${index + 1} needs both a filename and a file URL`, 'Close', { duration: 5000 });
        return;
      }

      if (!row.shortcode) {
        this.snackBar.open(`Row ${index + 1} needs a shortcode with only letters, numbers, or underscores`, 'Close', {
          duration: 5000,
        });
        return;
      }

      emojis.push(row);
    }

    if (emojis.length === 0) {
      this.snackBar.open('Please enter at least one emoji', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const identifier = this.editingSetId().trim() || this.generateRandomId();
      const success = await this.collectionSetsService.saveEmojiSet(identifier, name, emojis, this.editingSetTags());

      if (success) {
        this.snackBar.open('Emoji set saved successfully', 'Close', { duration: 3000 });
        this.cancelEditingSet();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to save emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving emoji set:', error);
      this.snackBar.open('Error saving emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async copyGifFfmpegCommand(): Promise<void> {
    await this.clipboard.copyText(this.gifFfmpegCommand, 'FFmpeg command copied to clipboard');
  }

  addEmojiRow(afterIndex?: number): void {
    const rows = [...this.editingSetRows()];
    const newRow = this.createEmptyEmojiRow();

    if (afterIndex === undefined || afterIndex < 0 || afterIndex >= rows.length) {
      rows.push(newRow);
    } else {
      rows.splice(afterIndex + 1, 0, newRow);
    }

    this.editingSetRows.set(rows);
  }

  removeEmojiRow(rowId: string): void {
    const rows = this.editingSetRows();
    const rowToRemove = rows.find(row => row.id === rowId);
    if (rowToRemove) {
      this.releasePreviewUrl(rowToRemove.previewUrl);
    }

    const nextRows = rows.filter(row => row.id !== rowId);
    this.editingSetRows.set(nextRows.length > 0 ? nextRows : [this.createEmptyEmojiRow()]);
  }

  updateEmojiRowValue(rowId: string, field: 'shortcode' | 'url', value: string): void {
    this.editingSetRows.update(rows => rows.map(row => {
      if (row.id !== rowId) {
        return row;
      }

      const normalizedValue = field === 'shortcode' ? normalizeEmojiShortcode(value) : value;
      const nextRow = { ...row, [field]: normalizedValue };
      if (field === 'url' && value.trim() && !row.previewUrl?.startsWith('blob:')) {
        nextRow.previewUrl = value.trim();
      }
      if (field === 'url' && !value.trim() && !row.previewUrl?.startsWith('blob:')) {
        nextRow.previewUrl = null;
      }
      if (field === 'url') {
        nextRow.uploadError = null;
      }
      return nextRow;
    }));
  }

  onEmojiRowEnter(event: Event, index: number): void {
    const keyboardEvent = event as KeyboardEvent;
    keyboardEvent.preventDefault();
    this.addEmojiRow(index);
  }

  onEmojiFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    void this.addFilesToEmojiRows(files);
    input.value = '';
  }

  onEmojiDropEnter(event: DragEvent): void {
    event.preventDefault();
    this.isEmojiDropTargetActive.set(true);
  }

  onEmojiDropOver(event: DragEvent): void {
    event.preventDefault();
    this.isEmojiDropTargetActive.set(true);
  }

  onEmojiDropLeave(event: DragEvent): void {
    event.preventDefault();

    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
      return;
    }

    this.isEmojiDropTargetActive.set(false);
  }

  onEmojiDrop(event: DragEvent): void {
    event.preventDefault();
    this.isEmojiDropTargetActive.set(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }

    void this.addFilesToEmojiRows(files);
  }

  openEditingEmojiPreview(row: EditableEmojiRow, event: MouseEvent): void {
    event.stopPropagation();

    const mediaUrl = row.url.trim() || row.previewUrl;
    if (!mediaUrl) {
      return;
    }

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl,
        mediaType: 'image',
        mediaTitle: row.shortcode ? `:${row.shortcode}:` : 'Emoji preview',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  private async addFilesToEmojiRows(files: File[]): Promise<void> {
    const validFiles = files.filter(file => this.isSupportedEmojiFile(file));
    const invalidCount = files.length - validFiles.length;

    if (validFiles.length === 0) {
      this.snackBar.open('Only image files can be added to emoji collections', 'Close', { duration: 4000 });
      return;
    }

    if (!this.hasMediaServers()) {
      this.promptMediaServerSetup();
      return;
    }

    const newRows = validFiles.map(file => {
      const previewUrl = URL.createObjectURL(file);
      return this.createEmptyEmojiRow({
        shortcode: this.getEmojiShortcodeFromFileName(file.name),
        previewUrl,
        isUploading: true,
      });
    });

    this.editingSetRows.update(rows => {
      const filledRows = rows.filter(row => row.shortcode.trim() || row.url.trim() || row.previewUrl);
      return [...filledRows, ...newRows];
    });

    if (invalidCount > 0) {
      this.snackBar.open(`${invalidCount} file${invalidCount === 1 ? '' : 's'} skipped because they are not images`, 'Close', {
        duration: 4000,
      });
    }

    const mediaServers = this.media.mediaServers();

    for (const [index, file] of validFiles.entries()) {
      const rowId = newRows[index].id;

      try {
        const uploadResult = await this.media.uploadFile(file, false, mediaServers);
        if (!uploadResult.item) {
          throw new Error(uploadResult.message || 'Upload failed');
        }

        this.editingSetRows.update(rows => rows.map(row => {
          if (row.id !== rowId) {
            return row;
          }

          this.releasePreviewUrl(row.previewUrl);
          return {
            ...row,
            url: uploadResult.item!.url,
            previewUrl: uploadResult.item!.url,
            isUploading: false,
            uploadError: null,
          };
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        this.logger.error('Error uploading emoji file:', error);
        this.editingSetRows.update(rows => rows.map(row => row.id === rowId
          ? {
            ...row,
            isUploading: false,
            uploadError: message,
          }
          : row));
      }
    }

    this.ensureTrailingEmptyRow();
  }

  private promptMediaServerSetup(): void {
    this.snackBar
      .open('You need to configure a media server before uploading emoji files.', 'Configure Now', {
        duration: 8000,
      })
      .onAction()
      .subscribe(() => {
        void this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      });
  }

  private isSupportedEmojiFile(file: File): boolean {
    if (file.type.startsWith('image/')) {
      return true;
    }

    return /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(file.name);
  }

  private getEmojiShortcodeFromFileName(fileName: string): string {
    const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim();
    return normalizeEmojiShortcode(withoutExtension) || 'emoji';
  }

  private ensureTrailingEmptyRow(): void {
    const rows = this.editingSetRows();
    const hasEmptyRow = rows.some(row => !row.shortcode.trim() && !row.url.trim() && !row.isUploading);
    if (!hasEmptyRow) {
      this.editingSetRows.set([...rows, this.createEmptyEmojiRow()]);
    }
  }

  private setEditingRows(rows: EditableEmojiRow[]): void {
    this.releasePreviewUrls(this.editingSetRows());
    this.editingSetRows.set(rows);
    this.ensureTrailingEmptyRow();
  }

  private createEmptyEmojiRow(overrides: Partial<EditableEmojiRow> = {}): EditableEmojiRow {
    return {
      id: `emoji-row-${this.nextEditingRowId++}`,
      shortcode: '',
      url: '',
      previewUrl: null,
      isUploading: false,
      uploadError: null,
      ...overrides,
    };
  }

  private releasePreviewUrls(rows: EditableEmojiRow[]): void {
    for (const row of rows) {
      this.releasePreviewUrl(row.previewUrl);
    }
  }

  private releasePreviewUrl(previewUrl: string | null): void {
    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
  }

  async deleteSet(set: EmojiSet) {
    const result = await this.deleteEventService.confirmDeletion({
      event: {
        id: set.eventId,
        kind: 30030,
        pubkey: this.accountState.pubkey() || '',
        content: '',
        created_at: set.created_at,
        tags: [['d', set.identifier]],
        sig: '',
      },
      title: 'Delete Emoji Set',
      entityLabel: 'emoji set',
      confirmText: 'Delete',
    });
    if (!result) return;

    this.isLoading.set(true);
    try {
      const success = await this.collectionSetsService.deleteEmojiSet(set.identifier, result.referenceMode);

      if (success) {
        this.snackBar.open('Emoji set deleted', 'Close', { duration: 3000 });
        await this.loadData();
      } else {
        this.snackBar.open('Failed to delete emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error deleting emoji set:', error);
      this.snackBar.open('Error deleting emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  findEmojis(): void {
    // Open search in the left panel
    this.layout.openSearchInLeftPanel('kind:30030');
  }

  async copyEmoji(emoji: EmojiItem, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(`:${emoji.shortcode}:`);
      this.copiedEmoji = emoji.shortcode;

      setTimeout(() => {
        this.copiedEmoji = null;
      }, 2000);
    } catch (err) {
      this.logger.error('Failed to copy emoji:', err);
    }
  }

  openEmojiPreview(emoji: EmojiItem, event: MouseEvent): void {
    event.stopPropagation();
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: emoji.url,
        mediaType: 'image',
        mediaTitle: `:${emoji.shortcode}:`,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  async copyPackData(pack: SuggestedEmojiPack): Promise<void> {
    if (!pack.event) {
      this.snackBar.open('Event data not available', 'Close', { duration: 3000 });
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(pack.event, null, 2));
      this.snackBar.open('Event data copied to clipboard', 'Close', { duration: 3000 });
    } catch (err) {
      this.logger.error('Failed to copy event data:', err);
    }
  }

  /**
   * Load suggested emoji packs with preview emojis
   */
  async loadSuggestedPacks(): Promise<void> {
    // Initialize suggested packs with loading state
    const packs: SuggestedEmojiPack[] = this.SUGGESTED_PACKS.map(pack => ({
      ...pack,
      previewEmojis: [],
      isLoading: true,
      isInstalling: false,
      event: null,
    }));
    this.suggestedPacks.set(packs);

    // Fetch each pack's preview emojis
    for (const pack of packs) {
      try {
        // First try the normal EmojiSetService method
        let emojiSet = await this.emojiSetService.getEmojiSet(pack.pubkey, pack.identifier);

        // If not found OR found but empty, and we have relay hints, try fetching from specific relays
        if ((!emojiSet || emojiSet.emojis.size === 0) && pack.relayHints && pack.relayHints.length > 0) {
          const event = await this.fetchEmojiSetFromRelays(pack.pubkey, pack.identifier, pack.relayHints);
          if (event) {
            // Parse the event to extract emojis
            const emojis = new Map<string, string>();
            const title = event.tags.find(tag => tag[0] === 'title')?.[1] ||
              event.tags.find(tag => tag[0] === 'd')?.[1] ||
              pack.title;

            for (const tag of event.tags) {
              if (tag[0] === 'emoji' && tag[1] && tag[2]) {
                emojis.set(tag[1], tag[2]);
              }
            }

            if (emojis.size > 0) {
              emojiSet = {
                id: `30030:${pack.pubkey}:${pack.identifier}`,
                title,
                emojis,
                event,
              };

              // Save to database for future use
              await this.database.saveEvent(event);
            }
          }
        }

        if (emojiSet) {
          // Get first 6 emojis as preview
          const previewEmojis: { shortcode: string; url: string }[] = [];
          let count = 0;
          for (const [shortcode, url] of emojiSet.emojis) {
            if (count >= 6) break;
            previewEmojis.push({ shortcode, url });
            count++;
          }
          pack.previewEmojis = previewEmojis;
          pack.title = emojiSet.title || pack.title;
          pack.event = emojiSet.event || null;
        }
      } catch (error) {
        this.logger.error(`Error loading suggested pack ${pack.identifier}:`, error);
      } finally {
        pack.isLoading = false;
      }
      // Update signal to trigger re-render
      this.suggestedPacks.set([...packs]);
    }
  }

  /**
   * Fetch emoji set from specific relays using relay hints
   */
  private async fetchEmojiSetFromRelays(
    pubkey: string,
    identifier: string,
    relayHints: string[]
  ): Promise<NostrEvent | null> {
    try {
      const event = await this.relayPool.get(
        relayHints,
        {
          kinds: [30030],
          authors: [pubkey],
          '#d': [identifier],
        },
        10000 // 10 second timeout
      );
      return event;
    } catch (error) {
      this.logger.error(`Error fetching emoji set from relays:`, error);
      return null;
    }
  }

  /**
   * Check if a suggested pack is already installed
   */
  isPackInstalled(pack: SuggestedEmojiPack): boolean {
    const refs = this.installedSetRefs();
    return refs.has(pack.identifier);
  }

  /**
   * Install a suggested emoji pack to user's kind 10030 preferences
   */
  async installPack(pack: SuggestedEmojiPack): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please sign in to install emoji packs', 'Close', { duration: 3000 });
      return;
    }

    // Update installing state
    const packs = this.suggestedPacks();
    const packIndex = packs.findIndex(p => p.identifier === pack.identifier);
    if (packIndex !== -1) {
      packs[packIndex].isInstalling = true;
      this.suggestedPacks.set([...packs]);
    }

    try {
      // Get current kind 10030 event
      const currentEvent = await this.database.getEventByPubkeyAndKind(pubkey, 10030);

      // Build new tags array
      let tags: string[][] = [];
      if (currentEvent) {
        tags = [...currentEvent.tags];
      }

      // Check if already installed
      const aTagValue = `30030:${pack.pubkey}:${pack.identifier}`;
      const alreadyInstalled = tags.some(tag => tag[0] === 'a' && tag[1] === aTagValue);

      if (alreadyInstalled) {
        this.snackBar.open('Emoji pack already installed', 'Close', { duration: 3000 });
        return;
      }

      // Add the new a tag reference with relay hint for discoverability
      const aTag = ['a', aTagValue];
      if (pack.relayHints && pack.relayHints.length > 0) {
        aTag.push(pack.relayHints[0]);
      }
      tags.push(aTag);

      // Create and sign the new event
      const event = this.nostrService.createEvent(10030, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);

      // Save to database
      await this.database.saveReplaceableEvent(signedEvent);

      // Publish to relays
      const result = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      if (result.success) {
        // Clear emoji set cache to force refresh
        this.emojiSetService.clearUserCache(pubkey);

        this.snackBar.open(`${pack.title} installed!`, 'Close', { duration: 3000 });

        // Reload data to show the new pack
        await this.loadData();
      } else {
        this.snackBar.open('Failed to install emoji pack', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error installing emoji pack:', error);
      this.snackBar.open('Error installing emoji pack', 'Close', { duration: 3000 });
    } finally {
      // Update installing state
      const updatedPacks = this.suggestedPacks();
      const idx = updatedPacks.findIndex(p => p.identifier === pack.identifier);
      if (idx !== -1) {
        updatedPacks[idx].isInstalling = false;
        this.suggestedPacks.set([...updatedPacks]);
      }
    }
  }

  /**
   * Load installed emoji set references from the raw kind 10030 event
   */
  private async loadInstalledSets(pubkey: string, preferred: PreferredEmojiSet[]): Promise<void> {
    const currentEvent = await this.database.getEventByPubkeyAndKind(pubkey, 10030);
    if (!currentEvent) {
      this.installedSetsList.set([]);
      return;
    }

    // Build a map from identifier to preferred set data for enrichment
    const preferredMap = new Map<string, PreferredEmojiSet>();
    for (const set of preferred) {
      preferredMap.set(set.identifier, set);
    }

    const installed: InstalledEmojiSetRef[] = [];
    for (const tag of currentEvent.tags) {
      if (tag[0] !== 'a' || !tag[1]?.startsWith('30030:')) continue;

      const parts = tag[1].split(':');
      if (parts.length < 3) continue;

      const [, refPubkey, identifier] = parts;
      const preferredSet = preferredMap.get(identifier);

      installed.push({
        aTagValue: tag[1],
        pubkey: refPubkey,
        identifier,
        title: preferredSet?.title || identifier,
        emojiCount: preferredSet?.emojis.length || 0,
        previewEmojis: (preferredSet?.emojis || []).slice(0, 6),
      });
    }

    this.installedSetsList.set(installed);
  }

  /**
   * Uninstall an emoji set by removing its reference from kind 10030
   */
  async uninstallSet(ref: InstalledEmojiSetRef): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Remove Emoji Set',
        message: `Are you sure you want to remove "${ref.title}"?`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (!result) return;

    this.isLoading.set(true);
    try {
      const currentEvent = await this.database.getEventByPubkeyAndKind(pubkey, 10030);
      if (!currentEvent) {
        this.snackBar.open('No emoji preferences found', 'Close', { duration: 3000 });
        return;
      }

      // Remove the matching a tag
      const newTags = currentEvent.tags.filter(
        (tag: string[]) => !(tag[0] === 'a' && tag[1] === ref.aTagValue)
      );

      if (newTags.length === currentEvent.tags.length) {
        this.snackBar.open('Set reference not found', 'Close', { duration: 3000 });
        return;
      }

      const event = this.nostrService.createEvent(10030, '', newTags);
      const signedEvent = await this.nostrService.signEvent(event);

      await this.database.saveReplaceableEvent(signedEvent);

      const publishResult = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false,
      });

      if (publishResult.success) {
        this.emojiSetService.clearUserCache(pubkey);
        this.snackBar.open(`${ref.title} removed`, 'Close', { duration: 3000 });
        await this.loadData();
      } else {
        this.snackBar.open('Failed to remove emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error removing emoji set:', error);
      this.snackBar.open('Error removing emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async uninstallSetByIdentifier(identifier: string, title: string): Promise<void> {
    const ref = this.installedSetsList().find(r => r.identifier === identifier);
    if (ref) {
      await this.uninstallSet(ref);
    } else {
      this.snackBar.open('Could not find set reference', 'Close', { duration: 3000 });
    }
  }
}
