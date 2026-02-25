import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Event as NostrEvent } from 'nostr-tools';
import { CollectionSetsService, EmojiSet, EmojiItem, PreferredEmojiSet } from '../../../services/collection-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { LayoutService } from '../../../services/layout.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { NostrService } from '../../../services/nostr.service';
import { DatabaseService } from '../../../services/database.service';
import { PublishService } from '../../../services/publish.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';

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
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './emoji-sets.component.html',
  styleUrl: './emoji-sets.component.scss',
})
export class EmojiSetsComponent implements OnInit {
  private collectionSetsService = inject(CollectionSetsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private emojiSetService = inject(EmojiSetService);
  private nostrService = inject(NostrService);
  private database = inject(DatabaseService);
  private publishService = inject(PublishService);
  private relayPool = inject(RelayPoolService);

  // State
  isLoading = signal(false);
  emojiSets = signal<EmojiSet[]>([]);
  preferredEmojis = signal<PreferredEmojiSet[]>([]);
  copiedEmoji: string | null = null;

  // Editing state
  isEditingSet = signal(false);
  editingSetId = signal<string | null>(null);
  editingSetName = signal('');
  editingSetEmojis = signal('');

  // Suggested emoji packs
  suggestedPacks = signal<SuggestedEmojiPack[]>([]);

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
    } catch (error) {
      this.logger.error('Error loading emoji data:', error);
      this.snackBar.open('Error loading emoji data', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  startCreatingSet() {
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetEmojis.set('');
    this.isEditingSet.set(true);
  }

  startEditingSet(set: EmojiSet) {
    this.editingSetId.set(set.identifier);
    this.editingSetName.set(set.name);
    this.editingSetEmojis.set(set.emojis.join('\n'));
    this.isEditingSet.set(true);
  }

  cancelEditingSet() {
    this.isEditingSet.set(false);
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetEmojis.set('');
  }

  async saveSetEdit() {
    const name = this.editingSetName().trim();
    const emojisInput = this.editingSetEmojis().trim();

    if (!name) {
      this.snackBar.open('Please enter a set name', 'Close', { duration: 3000 });
      return;
    }

    if (!emojisInput) {
      this.snackBar.open('Please enter at least one emoji', 'Close', { duration: 3000 });
      return;
    }

    // Parse emojis - one per line or space-separated
    const emojis = emojisInput
      .split(/[\n\s]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (emojis.length === 0) {
      this.snackBar.open('Please enter at least one emoji', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const identifier = this.editingSetId() || Date.now().toString();
      const success = await this.collectionSetsService.saveEmojiSet(identifier, name, emojis);

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

  async deleteSet(set: EmojiSet) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Emoji Set',
        message: `Are you sure you want to delete "${set.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (!result) return;

    this.isLoading.set(true);
    try {
      const success = await this.collectionSetsService.deleteEmojiSet(set.identifier);

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

      // Add the new a tag reference
      tags.push(['a', aTagValue]);

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
}
