import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { Event, nip19 } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { ApplicationService } from '../../services/application.service';
import { standardizedTag } from '../../standardized-tags';
import { AccountRelayServiceEx } from '../../services/relays/account-relay';

interface Draft {
  id: string;
  dTag: string;
  title: string;
  summary: string;
  content: string;
  createdAt: number;
  lastModified: number;
  tags: string[];
  imageUrl?: string;
  event: Event;
}

@Component({
  selector: 'app-drafts',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    AgoPipe,
  ],
  templateUrl: './drafts.component.html',
  styleUrl: './drafts.component.scss',
})
export class DraftsComponent {
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayServiceEx);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private data = inject(DataService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private dialog = inject(MatDialog);

  isLoading = signal(true);
  drafts = signal<Draft[]>([]);
  error = signal<string | null>(null);
  selectedTag = signal<string | null>(null);

  // Extract unique tags from all drafts
  availableTags = computed(() => {
    const tagSet = new Set<string>();
    this.drafts().forEach((draft) => {
      draft.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet);
  });

  // Filter drafts based on selected tag
  filteredDrafts = computed(() => {
    const tag = this.selectedTag();
    if (!tag) return this.drafts();
    return this.drafts().filter((draft) => draft.tags.includes(tag));
  });

  constructor() {
    effect(() => {
      if (this.app.initialized() && this.accountState.account()) {
        this.loadDrafts();
      }
    });
  }

  async loadDrafts(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const currentAccount = this.accountState.account();
      if (!currentAccount) {
        this.error.set('Please log in to view your drafts');
        this.isLoading.set(false);
        return;
      }

      // Get draft events (kind 30024) for the current user
      const draftRecords = await this.data.getEventsByPubkeyAndKind(
        currentAccount.pubkey,
        30024, // Draft long-form content
      );

      const drafts: Draft[] = draftRecords
        .map((record) => {
          try {
            const event = record.event;
            const content = event.content;

            // Extract d tag (identifier)
            const dTagArray = event.tags.find((tag) => tag[0] === 'd');
            const dTag = dTagArray ? dTagArray[1] : '';

            // Extract metadata from tags
            const titleTag = this.nostrService.getTags(event, standardizedTag.title);
            const imageTag = this.nostrService.getTags(event, standardizedTag.image);
            const summaryTag = this.nostrService.getTags(event, standardizedTag.summary);

            // Extract topic tags
            const topicTags = event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1]);

            return {
              id: event.id,
              dTag: dTag,
              title: titleTag[0] || 'Untitled Draft',
              summary: summaryTag[0] || this.generateSummary(content),
              content: content,
              createdAt: event.created_at,
              lastModified: event.created_at,
              tags: topicTags.length > 0 ? topicTags : [],
              imageUrl: imageTag[0],
              event: event,
            };
          } catch (error) {
            this.logger.error('Error parsing draft:', error);
            return null;
          }
        })
        .filter(Boolean) as Draft[];

      // Sort drafts by last modified (newest first)
      drafts.sort((a, b) => b.lastModified - a.lastModified);

      this.drafts.set(drafts);
    } catch (error) {
      this.logger.error('Error loading drafts:', error);
      this.error.set('Failed to load drafts');
    } finally {
      this.isLoading.set(false);
    }
  }

  private generateSummary(content: string): string {
    if (!content) return '';
    // Create a summary from the first ~150 chars of content
    const summary = content.slice(0, 150).trim();
    return summary.length < content.length ? `${summary}...` : summary;
  }

  openDraft(draft: Draft): void {
    // Navigate to article editor with the draft's naddr
    const naddr = nip19.naddrEncode({
      identifier: draft.dTag,
      pubkey: draft.event.pubkey,
      kind: 30024,
    });

    this.router.navigate(['/article/edit', naddr]);
  }

  createNewDraft(): void {
    this.router.navigate(['/article/create']);
  }

  async deleteDraft(draft: Draft, event?: MouseEvent): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Draft',
        message: `Are you sure you want to delete the draft "${draft.title}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        // Create a deletion event (kind 5)
        const deleteEvent = this.nostrService.createEvent(5, 'Deleted draft', [
          ['a', `30024:${draft.event.pubkey}:${draft.dTag}`],
          ['e', draft.event.id],
        ]);

        const signedEvent = await this.nostrService.signEvent(deleteEvent);
        await this.accountRelay.publish(signedEvent);

        // Remove from local list
        this.drafts.update((drafts) => drafts.filter((d) => d.id !== draft.id));

        this.snackBar.open('Draft deleted successfully', 'Close', {
          duration: 3000,
        });
      } catch (error) {
        this.logger.error('Error deleting draft:', error);
        this.snackBar.open('Failed to delete draft', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  filterByTag(tag: string): void {
    this.selectedTag.set(this.selectedTag() === tag ? null : tag);
  }

  clearTagFilter(): void {
    this.selectedTag.set(null);
  }

  async refreshDrafts(): Promise<void> {
    await this.loadDrafts();
    this.snackBar.open('Drafts refreshed', 'Close', {
      duration: 2000,
    });
  }
}
