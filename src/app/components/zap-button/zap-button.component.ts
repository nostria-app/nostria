import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy, NgZone, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event as NostrEvent } from 'nostr-tools';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { SettingsService } from '../../services/settings.service';
import { HapticsService } from '../../services/haptics.service';
import { ZapSoundService, getZapTier, ZapTier } from '../../services/zap-sound.service';

/**
 * Unified Zap Button - Supports both quick zap and custom zap.
 * 
 * When Quick Zap is ENABLED (in Settings > Wallet):
 * - Desktop: Single button with hover menu for custom zap option
 * - Mobile: Long-press to open custom zap dialog, tap for quick zap
 * - Shows amount badge on button
 * 
 * When Quick Zap is DISABLED:
 * - Click: Opens zap dialog for custom amount
 * - No badge shown
 */
@Component({
  selector: 'app-zap-button',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zap-button-container"
         [class.hover-active]="showHoverMenu()"
         [class.zap-tier-1]="celebrationTier() === 1"
         [class.zap-tier-2]="celebrationTier() === 2"
         [class.zap-tier-3]="celebrationTier() === 3"
         [class.zap-tier-4]="celebrationTier() === 4"
         [class.zap-tier-5]="celebrationTier() === 5"
         (mouseenter)="onMouseEnter()"
         (mouseleave)="onMouseLeave()">
      @if (quickZapEnabled()) {
        <!-- Quick Zap Mode -->
        <button
          mat-icon-button
          class="zap-button"
          [class.zapped]="hasZapped()"
          [class.loading]="isLoading()"
          [class.celebrating]="celebrationTier() > 0"
          [disabled]="isLoading()"
          (click)="sendQuickZap($event)"
          (touchstart)="onTouchStart($event)"
          (touchend)="onTouchEnd($event)"
          (touchcancel)="onTouchCancel()"
          [matTooltip]="isHandset() ? '' : quickZapTooltip()"
          matTooltipPosition="below"
        >
          <mat-icon>bolt</mat-icon>
          <span class="quick-zap-badge">{{ formatAmount(quickZapAmount()) }}</span>
        </button>
        <!-- Desktop hover menu for custom zap -->
        @if (showHoverMenu() && !isHandset()) {
          <div class="hover-menu">
            <button
              mat-icon-button
              class="custom-zap-button"
              (click)="openZapDialog($event)"
              matTooltip="Custom zap amount"
              matTooltipPosition="below"
            >
              <mat-icon>tune</mat-icon>
            </button>
          </div>
        }
      } @else {
        <!-- Standard Mode: Just opens dialog -->
        <button
          mat-icon-button
          class="zap-button"
          [class.zapped]="hasZapped()"
          [class.celebrating]="celebrationTier() > 0"
          [disabled]="isLoading()"
          (click)="openZapDialog($event)"
          [matTooltip]="tooltip()"
          matTooltipPosition="below"
        >
          <mat-icon>bolt</mat-icon>
        </button>
      }
      <!-- Celebration overlay -->
      @if (celebrationTier() > 0) {
        <div class="celebration-overlay">
          <!-- Glow rings -->
          <div class="glow-ring ring-1"></div>
          @if (celebrationTier() >= 3) {
            <div class="glow-ring ring-2"></div>
          }
          @if (celebrationTier() >= 4) {
            <div class="glow-ring ring-3"></div>
          }
          @if (celebrationTier() >= 5) {
            <div class="glow-ring ring-4"></div>
          }
          <!-- Tier 1: 4 bolt particles -->
          <span class="particle p1">⚡</span>
          <span class="particle p2">⚡</span>
          <span class="particle p3">⚡</span>
          <span class="particle p4">⚡</span>
          <!-- Tier 2+: additional bolts and stars -->
          @if (celebrationTier() >= 2) {
            <span class="particle p5">⚡</span>
            <span class="particle p6">✦</span>
            <span class="particle p7">⚡</span>
            <span class="particle p8">✦</span>
          }
          <!-- Tier 3+: sparkles and extra bolts -->
          @if (celebrationTier() >= 3) {
            <span class="particle p9">✨</span>
            <span class="particle p10">⚡</span>
            <span class="particle p11">✨</span>
            <span class="particle p12">⚡</span>
          }
          <!-- Tier 4+: coins and fire -->
          @if (celebrationTier() >= 4) {
            <span class="particle p13">🪙</span>
            <span class="particle p14">🔥</span>
            <span class="particle p15">🪙</span>
            <span class="particle p16">🔥</span>
            <span class="particle p17">⭐</span>
            <span class="particle p18">⚡</span>
          }
          <!-- Tier 5: rockets, explosions, crown, diamond -->
          @if (celebrationTier() >= 5) {
            <span class="particle p19">🚀</span>
            <span class="particle p20">💥</span>
            <span class="particle p21">👑</span>
            <span class="particle p22">💎</span>
            <span class="particle p23">🚀</span>
            <span class="particle p24">💥</span>
            <span class="particle p25">⚡</span>
            <span class="particle p26">✨</span>
            <span class="particle p27">⚡</span>
            <span class="particle p28">✨</span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .zap-button-container {
      display: inline-flex;
      align-items: center;
      position: relative;
    }

    .zap-button {
      color: var(--nostria-bitcoin) !important;
      transition: all 0.2s ease;
      position: relative;
    }

    .zap-button:hover {
      background-color: rgba(255, 107, 26, 0.1);
      transform: scale(1.05);
    }

    .zap-button:active {
      transform: scale(0.95);
    }

    .zap-button.zapped {
      color: var(--nostria-bitcoin) !important;
      background-color: rgba(255, 107, 26, 0.15);
    }

    .zap-button.loading {
      opacity: 0.6;
    }

    .zap-button mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .quick-zap-badge {
      position: absolute;
      bottom: 2px;
      right: 2px;
      font-size: 9px;
      background-color: var(--nostria-bitcoin);
      color: white;
      padding: 1px 3px;
      border-radius: 4px;
      line-height: 1.2;
      pointer-events: none;
    }

    /* Desktop hover menu */
    .hover-menu {
      position: absolute;
      left: 100%;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      margin-left: 2px;
      animation: slideIn 0.15s ease-out;
      z-index: 10;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-50%) translateX(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
    }

    .custom-zap-button {
      color: var(--mat-sys-on-surface-variant);
      background-color: var(--mat-sys-surface);
    }

    .custom-zap-button:hover {
      color: var(--nostria-bitcoin);
      background-color: var(--mat-sys-surface-container);
    }

    .custom-zap-button mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `],
})
export class ZapButtonComponent {
  // Inputs
  event = input<NostrEvent | null>(null);
  recipientPubkey = input<string | null>(null);
  recipientName = input<string | null>(null);
  recipientMetadata = input<Record<string, unknown> | null>(null);
  comment = input<string>('');

  // Outputs
  zapSent = output<number>();

  // Services
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private zapService = inject(ZapService);
  private dataService = inject(DataService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private settings = inject(SettingsService);
  private haptics = inject(HapticsService);
  private zapSound = inject(ZapSoundService);
  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);

  // State
  isLoading = signal(false);
  totalZaps = signal(0);
  hasZapped = signal(false);
  showHoverMenu = signal(false);
  celebrationTier = signal<number>(0); // 0 = not celebrating, 1-5 = tier

  // Celebration timer
  private celebrationTimer: ReturnType<typeof setTimeout> | null = null;

  // Long-press state for mobile
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;
  private readonly LONG_PRESS_DURATION = 500; // ms

  // Check if we're on mobile
  isHandset = computed(() => this.layout.isHandset());

  // Quick zap settings
  quickZapEnabled = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapEnabled ?? false;
  });

  quickZapAmount = computed(() => {
    const settings = this.settings.settings();
    return settings.quickZapAmount ?? 21;
  });

  // Computed tooltips
  quickZapTooltip = computed(() => {
    const amount = this.quickZapAmount();
    const name = this.recipientName() || 'user';
    const total = this.totalZaps();

    if (total) {
      return `${this.formatAmount(total)} sats zapped. Click to quick zap ${this.formatAmount(amount)} sats to ${name}`;
    }
    return `Quick zap ${this.formatAmount(amount)} sats to ${name}`;
  });

  tooltip = computed(() => {
    const target = this.event() ? 'event' : 'user';
    const name = this.recipientName() || 'user';
    const total = this.totalZaps();

    if (total) {
      return `${this.formatAmount(total)} sats zapped to this ${target}. Click to send a zap to ${name}.`;
    }

    return `Send a Lightning zap to ${name}`;
  });

  // Desktop hover handlers
  onMouseEnter(): void {
    if (!this.isHandset() && this.quickZapEnabled()) {
      this.showHoverMenu.set(true);
    }
  }

  onMouseLeave(): void {
    this.showHoverMenu.set(false);
  }

  // Mobile long-press handlers
  onTouchStart(event: TouchEvent): void {
    if (!this.isHandset() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.longPressTriggered = false;
    this.longPressTimer = setTimeout(() => {
      this.ngZone.run(() => {
        this.longPressTriggered = true;
        this.haptics.triggerMedium();
        // Open the custom zap dialog
        this.openZapDialog(event as unknown as MouseEvent);
      });
    }, this.LONG_PRESS_DURATION);
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // If long press was triggered, prevent the click event
    if (this.longPressTriggered) {
      event.preventDefault();
      event.stopPropagation();
      this.longPressTriggered = false;
    }
  }

  onTouchCancel(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressTriggered = false;
  }

  formatAmount(amount: number): string {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)}K`;
    }
    return amount.toString();
  }

  /** Public method to trigger zap from parent (e.g., when label is clicked). */
  onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.quickZapEnabled()) {
      this.sendQuickZap(event);
    } else {
      this.openZapDialog(event);
    }
  }

  // Quick zap functionality
  async sendQuickZap(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    if (this.isLoading()) {
      return;
    }

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const amount = this.quickZapAmount();
    if (amount <= 0) {
      this.snackBar.open('Quick zap amount not configured. Go to Settings > Wallet.', 'Dismiss', {
        duration: 4000,
      });
      return;
    }

    this.isLoading.set(true);

    try {
      const pubkey = this.recipientPubkey() || this.event()?.pubkey;
      if (!pubkey) {
        this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', { duration: 3000 });
        return;
      }

      let metadata = this.recipientMetadata();
      if (!metadata) {
        try {
          const userProfile = await this.dataService.getProfile(pubkey);
          if (userProfile?.data) {
            metadata = userProfile.data;
          }
        } catch (error) {
          console.warn('Failed to get user profile for zap:', error);
        }
      }

      if (metadata) {
        const lightningAddress = this.zapService.getLightningAddress(metadata);
        if (!lightningAddress) {
          this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
            duration: 4000,
          });
          return;
        }
      } else {
        this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
        return;
      }

      const currentEvent = this.event();
      const message = this.comment().trim();
      const eventKind = currentEvent?.kind;
      const eventAddress = this.getEventAddress(currentEvent);

      // Check for zap splits
      if (currentEvent) {
        const zapSplits = this.zapService.parseZapSplits(currentEvent);
        if (zapSplits.length > 0) {
          await this.zapService.sendSplitZap(currentEvent, amount, message);
          this.snackBar.open(
            `⚡ Zapped ${amount} sats split to ${zapSplits.length} recipients!`,
            'Dismiss',
            { duration: 4000 }
          );
          this.onZapSent(amount);
          return;
        }
      }

      // Send regular zap
      await this.zapService.sendZap(
        pubkey,
        amount,
        message,
        currentEvent?.id,
        metadata,
        undefined,
        undefined,
        eventKind,
        eventAddress
      );

      const recipientName = this.recipientName() ||
        (typeof metadata?.['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata?.['display_name'] === 'string' ? metadata['display_name'] : undefined);

      this.snackBar.open(
        `⚡ Zapped ${amount} sats${recipientName ? ` to ${recipientName}` : ''}!`,
        'Dismiss',
        { duration: 3000 }
      );

      this.onZapSent(amount);
    } catch (error) {
      console.error('Failed to send quick zap:', error);
      this.snackBar.open(
        `Failed to send zap: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Dismiss',
        { duration: 5000 }
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Custom zap dialog
  async openZapDialog(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    const currentEvent = this.event();
    if (currentEvent) {
      const zapSplits = this.zapService.parseZapSplits(currentEvent);
      if (zapSplits.length > 0) {
        this.openZapSplitDialog(currentEvent, zapSplits);
        return;
      }
    }

    const pubkey = this.recipientPubkey() || this.event()?.pubkey;
    if (!pubkey) {
      this.snackBar.open('Unable to determine recipient for zap', 'Dismiss', { duration: 3000 });
      return;
    }

    let metadata = this.recipientMetadata();
    if (!metadata) {
      try {
        const userProfile = await this.dataService.getProfile(pubkey);
        if (userProfile?.data) {
          metadata = userProfile.data;
        }
      } catch (error) {
        console.warn('Failed to get user profile for zap:', error);
      }
    }

    if (metadata) {
      const lightningAddress = this.zapService.getLightningAddress(metadata);
      if (!lightningAddress) {
        this.snackBar.open('This user has no lightning address configured for zaps', 'Dismiss', {
          duration: 4000,
        });
        return;
      }
    } else {
      this.snackBar.open('Unable to get recipient information for zap', 'Dismiss', { duration: 4000 });
      return;
    }

    const dialogData: ZapDialogData = {
      recipientPubkey: pubkey,
      recipientName:
        this.recipientName() ||
        (typeof metadata?.['name'] === 'string' ? metadata['name'] : undefined) ||
        (typeof metadata?.['display_name'] === 'string' ? metadata['display_name'] : undefined) ||
        undefined,
      recipientMetadata: metadata,
      eventId: currentEvent?.id,
      eventKind: currentEvent?.kind,
      eventAddress: this.getEventAddress(currentEvent),
      eventContent: currentEvent?.content ? this.truncateContent(currentEvent.content) : undefined,
      initialMessage: this.comment().trim() || undefined,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.onZapSent(result.amount);
      }
    });
  }

  private openZapSplitDialog(
    event: NostrEvent,
    splits: { pubkey: string; relay: string; weight: number }[]
  ): void {
    const dialogData: ZapDialogData = {
      recipientPubkey: event.pubkey,
      eventId: event.id,
      eventContent: event.content ? this.truncateContent(event.content) : undefined,
      initialMessage: this.comment().trim() || undefined,
      zapSplits: splits,
      event: event,
    };

    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.onZapSent(result.amount);
      }
    });
  }

  private getEventAddress(event: NostrEvent | null): string | undefined {
    if (!event) {
      return undefined;
    }

    if (event.kind < 30000 || event.kind >= 40000) {
      return undefined;
    }

    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) {
      return undefined;
    }

    return `${event.kind}:${event.pubkey}:${dTag}`;
  }

  private truncateContent(content: string): string {
    const maxLength = 100;
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  private onZapSent(amount: number): void {
    this.totalZaps.update(current => current + amount);
    this.hasZapped.set(true);
    this.haptics.triggerZapBuzz();
    this.zapSound.playZapSound(amount);
    this.triggerCelebration(amount);
    this.zapSent.emit(amount);
  }

  private triggerCelebration(amount: number): void {
    const tier = getZapTier(amount);

    // Clear any existing celebration
    if (this.celebrationTimer) {
      clearTimeout(this.celebrationTimer);
    }

    this.celebrationTier.set(tier);

    // Tier-appropriate duration
    const durations: Record<ZapTier, number> = {
      1: 600,
      2: 1000,
      3: 1100,
      4: 1300,
      5: 1800,
    };

    this.celebrationTimer = setTimeout(() => {
      this.celebrationTier.set(0);
      this.celebrationTimer = null;
    }, durations[tier]);
  }
}
