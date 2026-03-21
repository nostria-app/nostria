import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { nip19 } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { DatabaseService } from '../../services/database.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { LayoutService } from '../../services/layout.service';
import { NostrService } from '../../services/nostr.service';

@Component({
  selector: 'app-custom-emoji',
  imports: [MatMenuModule, MatIconModule],
  host: { style: 'display: inline' },
  template: `
    <img [src]="src()" [alt]="alt()" [title]="alt()" [class]="cssClass()" loading="lazy"
      (contextmenu)="onContextMenu($event)" />
    @if (emojiSetAddress()) {
      <div style="position: absolute; visibility: hidden; pointer-events: none"
        [matMenuTriggerFor]="emojiSetMenu" #menuTrigger="matMenuTrigger"></div>
      <mat-menu #emojiSetMenu="matMenu">
        <button mat-menu-item (click)="viewEmojiSet()">
          <mat-icon>emoji_emotions</mat-icon>
          <span>View Emoji Set</span>
        </button>
        @if (!isInstalled()) {
          <button mat-menu-item (click)="installEmojiSet()" [disabled]="isInstalling()">
            <mat-icon>download</mat-icon>
            <span>{{ isInstalling() ? 'Installing...' : 'Install Emoji Set' }}</span>
          </button>
        } @else {
          <button mat-menu-item disabled>
            <mat-icon>check</mat-icon>
            <span>Installed</span>
          </button>
        }
      </mat-menu>
    }
  `,
  styles: [`
    app-custom-emoji .emoji-icon-img {
      width: 20px;
      height: 20px;
      object-fit: contain;
    }
    app-custom-emoji .reaction-emoji-img {
      width: 20px;
      height: 20px;
      object-fit: contain;
    }
    app-custom-emoji .custom-emoji {
      display: inline-block;
      height: 1.5em;
      width: auto;
      vertical-align: middle;
      margin: 0 0.1em;
      object-fit: contain;
    }
    app-custom-emoji .reaction-custom-emoji {
      width: 18px;
      height: 18px;
      object-fit: contain;
      vertical-align: middle;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CustomEmojiComponent {
  private readonly layout = inject(LayoutService);
  private readonly accountState = inject(AccountStateService);
  private readonly nostrService = inject(NostrService);
  private readonly databaseService = inject(DatabaseService);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly snackBar = inject(MatSnackBar);

  src = input.required<string>();
  alt = input<string>('');
  cssClass = input<string>('custom-emoji');
  emojiSetAddress = input<string | undefined>();

  isInstalling = signal(false);
  isInstalled = signal(false);

  private menuTrigger = viewChild<MatMenuTrigger>('menuTrigger');

  constructor() {
    effect(() => {
      const address = this.emojiSetAddress();
      const pubkey = this.accountState.pubkey();

      if (!address || !pubkey) {
        untracked(() => this.isInstalled.set(false));
        return;
      }

      untracked(async () => {
        const installed = await this.emojiSetService.isEmojiSetInstalled(pubkey, address);
        this.isInstalled.set(installed);
      });
    });
  }

  onContextMenu(event: MouseEvent): void {
    if (!this.emojiSetAddress()) return;
    event.preventDefault();
    this.menuTrigger()?.openMenu();
  }

  viewEmojiSet(): void {
    const address = this.emojiSetAddress();
    if (!address) return;

    const parts = address.split(':');
    if (parts.length < 3 || parts[0] !== '30030') return;

    const naddr = nip19.naddrEncode({
      kind: 30030,
      pubkey: parts[1],
      identifier: parts.slice(2).join(':'),
    });

    this.layout.openGenericEvent(naddr);
  }

  async installEmojiSet(): Promise<void> {
    const address = this.emojiSetAddress();
    if (!address || this.isInstalling() || this.isInstalled()) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please sign in to install emoji sets', 'Close', { duration: 3000 });
      return;
    }

    this.isInstalling.set(true);

    try {
      const existingPrefs = await this.databaseService.getEventByPubkeyAndKind(pubkey, 10030);

      const tags: string[][] = [];

      if (existingPrefs) {
        for (const tag of existingPrefs.tags) {
          if (tag[0] === 'a' && tag[1] === address) continue;
          tags.push(tag);
        }
      }

      tags.push(['a', address]);

      const prefsEvent = this.nostrService.createEvent(10030, '', tags);
      const result = await this.nostrService.signAndPublish(prefsEvent);

      if (result.success && result.event) {
        await this.databaseService.saveReplaceableEvent(result.event);
        this.isInstalled.set(true);
        this.emojiSetService.clearUserCache(pubkey);
        this.snackBar.open('Emoji set installed!', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to install emoji set', 'Close', { duration: 3000 });
      }
    } catch {
      this.snackBar.open('Failed to install emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isInstalling.set(false);
    }
  }
}
