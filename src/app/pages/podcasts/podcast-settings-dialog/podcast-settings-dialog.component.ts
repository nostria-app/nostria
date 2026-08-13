import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { DEFAULT_PODCAST_RELAYS } from '../../../utils/podcast-default-relays';

const RELAY_SET_KIND = 30002;
const PODCAST_RELAY_SET_D_TAG = 'podcasts';

@Component({
  selector: 'app-podcast-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <app-custom-dialog [title]="title" headerIcon="settings" (closed)="close(null)">
      <div dialog-content>
        <p i18n="@@podcasts.settings.intro">Add dedicated relays used to discover podcast episodes and shows.</p>
        @if (isLoading()) {
          <mat-spinner diameter="32"></mat-spinner>
        } @else {
          <div class="relays">
            @for (relay of relays(); track relay) {
              <div class="relay-row">
                <span>{{ relay }}</span>
                <button mat-icon-button (click)="removeRelay(relay)" aria-label="Remove relay">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.settings.relayUrl">Relay URL</mat-label>
            <input matInput [(ngModel)]="newRelayUrl" (keydown.enter)="addRelay()" />
          </mat-form-field>
          <button mat-stroked-button (click)="addRelay()">
            <mat-icon>add</mat-icon>
            <span i18n="@@podcasts.settings.addRelay">Add relay</span>
          </button>
          <button mat-button (click)="useDefaults()">
            <span i18n="@@podcasts.settings.defaults">Use defaults</span>
          </button>
        }
      </div>
      <div dialog-actions>
        <button mat-button (click)="close(null)" i18n="@@common.cancel">Cancel</button>
        <button mat-flat-button (click)="save()" [disabled]="isSaving()">
          <span i18n="@@common.save">Save</span>
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`
    p { color: var(--mat-sys-on-surface-variant); }
    .relay-row { display: flex; align-items: center; gap: 0.5rem; }
    .relay-row span { flex: 1; color: var(--mat-sys-on-surface); overflow: hidden; text-overflow: ellipsis; }
    .full { width: 100%; margin-top: 1rem; }
  `],
})
export class PodcastSettingsDialogComponent implements OnInit {
  closed = output<{ saved: boolean } | null>();

  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);

  readonly title = $localize`:@@podcasts.settings.title:Podcast settings`;
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly relays = signal<string[]>([]);
  newRelayUrl = '';

  async ngOnInit(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.relays.set([...DEFAULT_PODCAST_RELAYS]);
      this.isLoading.set(false);
      return;
    }

    const cached = await this.database.getParameterizedReplaceableEvent(pubkey, RELAY_SET_KIND, PODCAST_RELAY_SET_D_TAG);
    if (cached) {
      this.relays.set(this.extractRelays(cached));
    } else {
      this.relays.set([...DEFAULT_PODCAST_RELAYS]);
    }
    this.isLoading.set(false);
  }

  addRelay(): void {
    const url = this.newRelayUrl.trim();
    if (!url) return;
    const normalized = url.endsWith('/') ? url : `${url}/`;
    if (!this.relays().includes(normalized)) {
      this.relays.update(relays => [...relays, normalized]);
    }
    this.newRelayUrl = '';
  }

  removeRelay(relay: string): void {
    this.relays.update(relays => relays.filter(item => item !== relay));
  }

  useDefaults(): void {
    this.relays.set([...DEFAULT_PODCAST_RELAYS]);
  }

  async save(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.close({ saved: false });
      return;
    }

    this.isSaving.set(true);
    try {
      const event = {
        kind: RELAY_SET_KIND,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [
          ['d', PODCAST_RELAY_SET_D_TAG],
          ['title', 'Podcasts'],
          ...this.relays().map(relay => ['relay', relay]),
        ],
        id: '',
        sig: '',
      } as Event;

      const signed = await this.nostr.signEvent(event);
      await this.database.saveEvent({ ...signed, dTag: PODCAST_RELAY_SET_D_TAG });
      await this.accountRelay.publish(signed);
      this.close({ saved: true });
    } catch {
      this.snackBar.open($localize`:@@podcasts.settings.saveFailed:Failed to save podcast relays`, '', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  close(result: { saved: boolean } | null): void {
    this.closed.emit(result);
  }

  private extractRelays(event: Event): string[] {
    return event.tags.filter(tag => tag[0] === 'relay' && !!tag[1]).map(tag => tag[1]);
  }
}
