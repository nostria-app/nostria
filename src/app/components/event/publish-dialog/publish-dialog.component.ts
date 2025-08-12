import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { Event } from 'nostr-tools';
import { AccountRelayService } from '../../../services/account-relay.service';
import { NostrService } from '../../../services/nostr.service';
import { RelayService } from '../../../services/relay.service';

export interface PublishDialogData {
  event: Event;
}

interface PublishOption {
  id: 'account' | 'author' | 'custom';
  label: string;
  description: string;
}

interface RelayPublishResult {
  url: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

@Component({
  selector: 'app-publish-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatListModule,
    FormsModule,
  ],
  templateUrl: './publish-dialog.component.html',
  styleUrl: './publish-dialog.component.scss',
})
export class PublishDialogComponent {
  private dialogRef = inject(MatDialogRef<PublishDialogComponent>);
  data: PublishDialogData = inject(MAT_DIALOG_DATA);
  private accountRelayService = inject(AccountRelayService);
  private nostrService = inject(NostrService);
  relayService = inject(RelayService);

  selectedOptions = signal<Set<'account' | 'author' | 'custom'>>(
    new Set(['account'])
  );
  customRelayInput = signal<string>('');
  customRelays = signal<string[]>([]);
  publishResults = signal<RelayPublishResult[]>([]);
  isPublishing = signal<boolean>(false);
  authorRelays = signal<string[]>([]);
  loadingAuthorRelays = signal<boolean>(false);
  showJsonView = signal<boolean>(false);

  publishOptions: PublishOption[] = [
    {
      id: 'account',
      label: 'Account Relays',
      description: 'Publish to your configured account relays',
    },
    {
      id: 'author',
      label: "Author's Relays",
      description: "Publish to the original author's relays",
    },
    {
      id: 'custom',
      label: 'Additional Relays',
      description: 'Publish to manually specified relays',
    },
  ];

  constructor() {
    // Load author's relays when component initializes
    effect(async () => {
      if (this.data?.event?.pubkey) {
        this.loadingAuthorRelays.set(true);
        try {
          const relays = await this.nostrService.getRelays(
            this.data.event.pubkey
          );
          this.authorRelays.set(relays || []);
        } catch (error) {
          console.error('Error loading author relays:', error);
          this.authorRelays.set([]);
        } finally {
          this.loadingAuthorRelays.set(false);
        }
      }
    });
  }

  addCustomRelay(): void {
    const relayUrl = this.customRelayInput().trim();
    if (relayUrl && !this.customRelays().includes(relayUrl)) {
      // Basic URL validation
      try {
        const url = new URL(relayUrl);
        if (url.protocol === 'wss:' || url.protocol === 'ws:') {
          this.customRelays.update(relays => [...relays, relayUrl]);
          this.customRelayInput.set('');
        } else {
          alert('Please enter a valid WebSocket URL (wss:// or ws://)');
        }
      } catch {
        alert('Please enter a valid URL');
      }
    }
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
  }
  getTargetRelays(): string[] {
    const selectedOptions = this.selectedOptions();
    const allRelays: string[] = [];

    if (selectedOptions.has('account')) {
      allRelays.push(...this.relayService.getAccountRelayUrls());
    }

    if (selectedOptions.has('author')) {
      allRelays.push(...this.authorRelays());
    }

    if (selectedOptions.has('custom')) {
      allRelays.push(...this.customRelays());
    }

    // Remove duplicates
    return [...new Set(allRelays)];
  }

  onOptionChange(
    option: 'account' | 'author' | 'custom',
    checked: boolean
  ): void {
    this.selectedOptions.update(options => {
      const newOptions = new Set(options);
      if (checked) {
        newOptions.add(option);
      } else {
        newOptions.delete(option);
      }
      return newOptions;
    });
  }

  isOptionSelected(option: 'account' | 'author' | 'custom'): boolean {
    return this.selectedOptions().has(option);
  }

  async publish(): Promise<void> {
    const targetRelays = this.getTargetRelays();

    if (targetRelays.length === 0) {
      alert('No relays selected for publishing');
      return;
    }

    this.isPublishing.set(true);

    // Initialize publish results
    const initialResults: RelayPublishResult[] = targetRelays.map(url => ({
      url,
      status: 'pending',
    }));
    this.publishResults.set(initialResults);

    try {
      // Use the pool to publish to multiple relays
      const publishPromises = this.accountRelayService.pool.publish(
        targetRelays,
        this.data.event
      );

      // Wait for all publish attempts to complete
      await Promise.allSettled(
        publishPromises.map(async (promise, index) => {
          try {
            await promise;
            this.updatePublishResult(
              targetRelays[index],
              'success',
              'Published successfully'
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.updatePublishResult(
              targetRelays[index],
              'error',
              errorMessage
            );
          }
        })
      );
    } catch (error) {
      console.error('Error during publishing:', error);
    } finally {
      this.isPublishing.set(false);
    }
  }

  private updatePublishResult(
    url: string,
    status: 'success' | 'error',
    message?: string
  ): void {
    this.publishResults.update(results =>
      results.map(result =>
        result.url === url ? { ...result, status, message } : result
      )
    );
  }

  close(): void {
    this.dialogRef.close();
  }

  canPublish(): boolean {
    return !this.isPublishing() && this.getTargetRelays().length > 0;
  }

  toggleJsonView(): void {
    this.showJsonView.update(show => !show);
  }

  getEventJson(): string {
    return JSON.stringify(this.data.event, null, 2);
  }
}
