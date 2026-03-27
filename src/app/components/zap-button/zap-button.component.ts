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
          [disabled]="isLoading() || disabled()"
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
              [disabled]="disabled()"
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
          [disabled]="isLoading() || disabled()"
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

    /* ── Celebration overlay ───────────────────────────────── */
    .celebration-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
      pointer-events: none;
      z-index: 100;
    }

    /* ── Bolt shake per tier ──────────────────────────────── */
    .zap-tier-1 .zap-button.celebrating mat-icon {
      animation: zapShake1 0.4s ease-out;
    }
    .zap-tier-2 .zap-button.celebrating mat-icon {
      animation: zapShake2 0.5s ease-out;
    }
    .zap-tier-3 .zap-button.celebrating mat-icon {
      animation: zapShake3 0.6s ease-out;
    }
    .zap-tier-4 .zap-button.celebrating mat-icon {
      animation: zapShake4 0.7s ease-out;
    }
    .zap-tier-5 .zap-button.celebrating mat-icon {
      animation: zapShake5 0.9s ease-out;
    }

    @keyframes zapShake1 {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-1px); }
      75% { transform: translateX(1px); }
    }
    @keyframes zapShake2 {
      0%, 100% { transform: translateX(0) rotate(0deg); }
      20% { transform: translateX(-2px) rotate(-3deg); }
      40% { transform: translateX(2px) rotate(3deg); }
      60% { transform: translateX(-1px) rotate(-1deg); }
      80% { transform: translateX(1px) rotate(1deg); }
    }
    @keyframes zapShake3 {
      0%, 100% { transform: translate(0) rotate(0deg); }
      15% { transform: translate(-3px, -1px) rotate(-5deg); }
      30% { transform: translate(3px, 1px) rotate(5deg); }
      45% { transform: translate(-2px, -1px) rotate(-3deg); }
      60% { transform: translate(2px, 1px) rotate(3deg); }
      75% { transform: translate(-1px) rotate(-1deg); }
    }
    @keyframes zapShake4 {
      0%, 100% { transform: translate(0) rotate(0deg) scale(1); }
      10% { transform: translate(-4px, -2px) rotate(-8deg) scale(1.1); }
      20% { transform: translate(4px, 2px) rotate(8deg) scale(1.1); }
      30% { transform: translate(-3px, -1px) rotate(-5deg) scale(1.05); }
      40% { transform: translate(3px, 1px) rotate(5deg) scale(1.05); }
      50% { transform: translate(-2px) rotate(-3deg); }
      60% { transform: translate(2px) rotate(3deg); }
      70% { transform: translate(-1px) rotate(-1deg); }
    }
    @keyframes zapShake5 {
      0%, 100% { transform: translate(0) rotate(0deg) scale(1); }
      5% { transform: translate(-5px, -3px) rotate(-12deg) scale(1.2); }
      10% { transform: translate(5px, 3px) rotate(12deg) scale(1.2); }
      15% { transform: translate(-4px, -2px) rotate(-8deg) scale(1.15); }
      20% { transform: translate(4px, 2px) rotate(8deg) scale(1.15); }
      30% { transform: translate(-3px, -1px) rotate(-5deg) scale(1.1); }
      40% { transform: translate(3px, 1px) rotate(5deg) scale(1.1); }
      50% { transform: translate(-2px) rotate(-3deg) scale(1.05); }
      60% { transform: translate(2px) rotate(3deg) scale(1.05); }
      70% { transform: translate(-1px) rotate(-1deg); }
      80% { transform: translate(1px) rotate(1deg); }
    }

    /* ── Button pop per tier ─────────────────────────────── */
    .zap-tier-1 .zap-button.celebrating {
      animation: zapPop1 0.3s ease-out;
    }
    .zap-tier-2 .zap-button.celebrating {
      animation: zapPop2 0.4s ease-out;
    }
    .zap-tier-3 .zap-button.celebrating {
      animation: zapPop3 0.5s ease-out;
    }
    .zap-tier-4 .zap-button.celebrating {
      animation: zapPop4 0.6s ease-out;
    }
    .zap-tier-5 .zap-button.celebrating {
      animation: zapPop5 0.7s ease-out;
    }

    @keyframes zapPop1 {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    @keyframes zapPop2 {
      0% { transform: scale(1); }
      40% { transform: scale(1.2); }
      70% { transform: scale(0.95); }
      100% { transform: scale(1); }
    }
    @keyframes zapPop3 {
      0% { transform: scale(1); }
      30% { transform: scale(1.3); }
      60% { transform: scale(0.9); }
      80% { transform: scale(1.05); }
      100% { transform: scale(1); }
    }
    @keyframes zapPop4 {
      0% { transform: scale(1); }
      20% { transform: scale(1.4); }
      40% { transform: scale(0.85); }
      60% { transform: scale(1.15); }
      80% { transform: scale(0.95); }
      100% { transform: scale(1); }
    }
    @keyframes zapPop5 {
      0% { transform: scale(1); }
      15% { transform: scale(1.5); }
      30% { transform: scale(0.8); }
      45% { transform: scale(1.3); }
      60% { transform: scale(0.9); }
      75% { transform: scale(1.1); }
      90% { transform: scale(0.95); }
      100% { transform: scale(1); }
    }

    /* ── Glow rings ──────────────────────────────────────── */
    .glow-ring {
      position: absolute;
      border-radius: 50%;
      border: 2px solid var(--nostria-bitcoin);
      opacity: 0;
      pointer-events: none;
    }

    .zap-tier-1 .ring-1 {
      animation: zapGlow1 0.5s ease-out forwards;
    }
    .zap-tier-2 .ring-1 {
      animation: zapGlow2 0.7s ease-out forwards;
    }
    .zap-tier-3 .ring-1 {
      animation: zapGlow2 0.7s ease-out forwards;
    }
    .zap-tier-3 .ring-2 {
      animation: zapGlow3 0.8s 0.1s ease-out forwards;
    }
    .zap-tier-4 .ring-1 {
      animation: zapGlow3 0.8s ease-out forwards;
    }
    .zap-tier-4 .ring-2 {
      animation: zapGlow4 0.9s 0.1s ease-out forwards;
    }
    .zap-tier-4 .ring-3 {
      animation: zapGlow4 1s 0.2s ease-out forwards;
    }
    .zap-tier-5 .ring-1 {
      animation: zapGlow4 0.9s ease-out forwards;
    }
    .zap-tier-5 .ring-2 {
      animation: zapGlow5 1s 0.08s ease-out forwards;
    }
    .zap-tier-5 .ring-3 {
      animation: zapGlow5 1.1s 0.16s ease-out forwards;
    }
    .zap-tier-5 .ring-4 {
      animation: zapGlow5 1.2s 0.24s ease-out forwards;
    }

    @keyframes zapGlow1 {
      0% { width: 0; height: 0; top: 0; left: 0; opacity: 0.6; }
      100% { width: 24px; height: 24px; top: -12px; left: -12px; opacity: 0; }
    }
    @keyframes zapGlow2 {
      0% { width: 0; height: 0; top: 0; left: 0; opacity: 0.7; border-width: 2px; }
      100% { width: 36px; height: 36px; top: -18px; left: -18px; opacity: 0; border-width: 1px; }
    }
    @keyframes zapGlow3 {
      0% { width: 0; height: 0; top: 0; left: 0; opacity: 0.8; border-width: 3px; }
      100% { width: 48px; height: 48px; top: -24px; left: -24px; opacity: 0; border-width: 1px; }
    }
    @keyframes zapGlow4 {
      0% { width: 0; height: 0; top: 0; left: 0; opacity: 0.8; border-width: 3px; }
      100% { width: 60px; height: 60px; top: -30px; left: -30px; opacity: 0; border-width: 1px; }
    }
    @keyframes zapGlow5 {
      0% { width: 0; height: 0; top: 0; left: 0; opacity: 0.9; border-width: 4px; border-color: #ff6b1a; }
      50% { border-color: #ffcc00; }
      100% { width: 80px; height: 80px; top: -40px; left: -40px; opacity: 0; border-width: 1px; border-color: #ff6b1a; }
    }

    /* ── Particles base ──────────────────────────────────── */
    .particle {
      position: absolute;
      font-size: 10px;
      opacity: 0;
      pointer-events: none;
    }

    /* ── Tier 1 particles: gentle drift ──────────────────── */
    .zap-tier-1 .p1 { animation: t1fly1 0.5s ease-out forwards; }
    .zap-tier-1 .p2 { animation: t1fly2 0.5s ease-out forwards; }
    .zap-tier-1 .p3 { animation: t1fly3 0.5s ease-out forwards; }
    .zap-tier-1 .p4 { animation: t1fly4 0.5s ease-out forwards; }

    @keyframes t1fly1 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.5); }
      100% { opacity: 0; transform: translate(-12px, -14px) scale(0.3); }
    }
    @keyframes t1fly2 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.5); }
      100% { opacity: 0; transform: translate(12px, -12px) scale(0.3); }
    }
    @keyframes t1fly3 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.5); }
      100% { opacity: 0; transform: translate(-10px, 12px) scale(0.3); }
    }
    @keyframes t1fly4 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.5); }
      100% { opacity: 0; transform: translate(10px, 14px) scale(0.3); }
    }

    /* ── Tier 2 particles: moderate burst ────────────────── */
    .zap-tier-2 .p1 { animation: t2fly1 0.7s ease-out forwards; }
    .zap-tier-2 .p2 { animation: t2fly2 0.7s ease-out forwards; }
    .zap-tier-2 .p3 { animation: t2fly3 0.7s ease-out forwards; }
    .zap-tier-2 .p4 { animation: t2fly4 0.7s ease-out forwards; }
    .zap-tier-2 .p5 { animation: t2fly5 0.7s 0.05s ease-out forwards; }
    .zap-tier-2 .p6 { animation: t2fly6 0.7s 0.05s ease-out forwards; font-size: 8px; }
    .zap-tier-2 .p7 { animation: t2fly7 0.7s 0.1s ease-out forwards; }
    .zap-tier-2 .p8 { animation: t2fly8 0.7s 0.1s ease-out forwards; font-size: 8px; }

    @keyframes t2fly1 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-18px, -20px) scale(0.3); }
    }
    @keyframes t2fly2 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(18px, -18px) scale(0.3); }
    }
    @keyframes t2fly3 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-16px, 18px) scale(0.3); }
    }
    @keyframes t2fly4 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(16px, 20px) scale(0.3); }
    }
    @keyframes t2fly5 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(-22px, -4px) scale(0.2); }
    }
    @keyframes t2fly6 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(22px, 4px) scale(0.2); }
    }
    @keyframes t2fly7 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(-6px, -24px) scale(0.2); }
    }
    @keyframes t2fly8 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(6px, 24px) scale(0.2); }
    }

    /* ── Tier 3 particles: vigorous with sparkles ────────── */
    .zap-tier-3 .p1 { animation: t3fly1 0.8s ease-out forwards; font-size: 12px; }
    .zap-tier-3 .p2 { animation: t3fly2 0.8s ease-out forwards; font-size: 12px; }
    .zap-tier-3 .p3 { animation: t3fly3 0.8s ease-out forwards; font-size: 12px; }
    .zap-tier-3 .p4 { animation: t3fly4 0.8s ease-out forwards; font-size: 12px; }
    .zap-tier-3 .p5 { animation: t3fly5 0.8s 0.05s ease-out forwards; }
    .zap-tier-3 .p6 { animation: t3fly6 0.8s 0.05s ease-out forwards; font-size: 9px; }
    .zap-tier-3 .p7 { animation: t3fly7 0.8s 0.1s ease-out forwards; }
    .zap-tier-3 .p8 { animation: t3fly8 0.8s 0.1s ease-out forwards; font-size: 9px; }
    .zap-tier-3 .p9 { animation: t3fly9 0.9s 0.08s ease-out forwards; font-size: 8px; }
    .zap-tier-3 .p10 { animation: t3fly10 0.9s 0.12s ease-out forwards; }
    .zap-tier-3 .p11 { animation: t3fly11 0.9s 0.15s ease-out forwards; font-size: 8px; }
    .zap-tier-3 .p12 { animation: t3fly12 0.9s 0.18s ease-out forwards; }

    @keyframes t3fly1 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-24px, -26px) scale(0.3); }
    }
    @keyframes t3fly2 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(24px, -24px) scale(0.3); }
    }
    @keyframes t3fly3 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-22px, 24px) scale(0.3); }
    }
    @keyframes t3fly4 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(22px, 26px) scale(0.3); }
    }
    @keyframes t3fly5 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-28px, -6px) scale(0.2); }
    }
    @keyframes t3fly6 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(28px, 6px) scale(0.2); }
    }
    @keyframes t3fly7 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-8px, -30px) scale(0.2); }
    }
    @keyframes t3fly8 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(8px, 30px) scale(0.2); }
    }
    @keyframes t3fly9 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(-15px, -32px) scale(0.2); }
    }
    @keyframes t3fly10 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(30px, -10px) scale(0.2); }
    }
    @keyframes t3fly11 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(15px, 32px) scale(0.2); }
    }
    @keyframes t3fly12 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.6); }
      100% { opacity: 0; transform: translate(-30px, 10px) scale(0.2); }
    }

    /* ── Tier 4 particles: intense with coins and fire ──── */
    .zap-tier-4 .p1 { animation: t4fly1 1s ease-out forwards; font-size: 14px; }
    .zap-tier-4 .p2 { animation: t4fly2 1s ease-out forwards; font-size: 14px; }
    .zap-tier-4 .p3 { animation: t4fly3 1s ease-out forwards; font-size: 14px; }
    .zap-tier-4 .p4 { animation: t4fly4 1s ease-out forwards; font-size: 14px; }
    .zap-tier-4 .p5 { animation: t4fly5 1s 0.05s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p6 { animation: t4fly6 1s 0.05s ease-out forwards; font-size: 10px; }
    .zap-tier-4 .p7 { animation: t4fly7 1s 0.1s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p8 { animation: t4fly8 1s 0.1s ease-out forwards; font-size: 10px; }
    .zap-tier-4 .p9 { animation: t4fly9 1s 0.08s ease-out forwards; font-size: 10px; }
    .zap-tier-4 .p10 { animation: t4fly10 1s 0.12s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p11 { animation: t4fly11 1s 0.15s ease-out forwards; font-size: 10px; }
    .zap-tier-4 .p12 { animation: t4fly12 1s 0.18s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p13 { animation: t4fly13 1.1s 0.1s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p14 { animation: t4fly14 1.1s 0.12s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p15 { animation: t4fly15 1.1s 0.15s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p16 { animation: t4fly16 1.1s 0.18s ease-out forwards; font-size: 12px; }
    .zap-tier-4 .p17 { animation: t4fly17 1.1s 0.2s ease-out forwards; font-size: 10px; }
    .zap-tier-4 .p18 { animation: t4fly18 1.1s 0.22s ease-out forwards; font-size: 12px; }

    @keyframes t4fly1 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-30px, -34px) scale(0.3); }
    }
    @keyframes t4fly2 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(30px, -32px) scale(0.3); }
    }
    @keyframes t4fly3 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-28px, 32px) scale(0.3); }
    }
    @keyframes t4fly4 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(28px, 34px) scale(0.3); }
    }
    @keyframes t4fly5 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-36px, -8px) scale(0.2); }
    }
    @keyframes t4fly6 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(36px, 8px) scale(0.2); }
    }
    @keyframes t4fly7 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-10px, -38px) scale(0.2); }
    }
    @keyframes t4fly8 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(10px, 38px) scale(0.2); }
    }
    @keyframes t4fly9 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-20px, -38px) scale(0.2); }
    }
    @keyframes t4fly10 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(38px, -14px) scale(0.2); }
    }
    @keyframes t4fly11 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(20px, 38px) scale(0.2); }
    }
    @keyframes t4fly12 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-38px, 14px) scale(0.2); }
    }
    @keyframes t4fly13 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-34px, -20px) scale(0.3); }
    }
    @keyframes t4fly14 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(16px, -36px) scale(0.3); }
    }
    @keyframes t4fly15 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(34px, 20px) scale(0.3); }
    }
    @keyframes t4fly16 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-16px, 36px) scale(0.3); }
    }
    @keyframes t4fly17 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(0, -40px) scale(0.2); }
    }
    @keyframes t4fly18 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(0, 40px) scale(0.2); }
    }

    /* ── Tier 5 particles: full chaos ────────────────────── */
    .zap-tier-5 .p1 { animation: t5fly1 1.4s ease-out forwards; font-size: 16px; }
    .zap-tier-5 .p2 { animation: t5fly2 1.4s ease-out forwards; font-size: 16px; }
    .zap-tier-5 .p3 { animation: t5fly3 1.4s ease-out forwards; font-size: 16px; }
    .zap-tier-5 .p4 { animation: t5fly4 1.4s ease-out forwards; font-size: 16px; }
    .zap-tier-5 .p5 { animation: t5fly5 1.4s 0.05s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p6 { animation: t5fly6 1.4s 0.05s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p7 { animation: t5fly7 1.4s 0.1s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p8 { animation: t5fly8 1.4s 0.1s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p9 { animation: t5fly9 1.4s 0.08s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p10 { animation: t5fly10 1.4s 0.12s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p11 { animation: t5fly11 1.4s 0.15s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p12 { animation: t5fly12 1.4s 0.18s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p13 { animation: t5fly13 1.5s 0.1s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p14 { animation: t5fly14 1.5s 0.12s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p15 { animation: t5fly15 1.5s 0.15s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p16 { animation: t5fly16 1.5s 0.18s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p17 { animation: t5fly17 1.5s 0.2s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p18 { animation: t5fly18 1.5s 0.22s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p19 { animation: t5fly19 1.6s 0.1s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p20 { animation: t5fly20 1.6s 0.15s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p21 { animation: t5fly21 1.6s 0.2s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p22 { animation: t5fly22 1.6s 0.25s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p23 { animation: t5fly23 1.6s 0.3s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p24 { animation: t5fly24 1.6s 0.35s ease-out forwards; font-size: 14px; }
    .zap-tier-5 .p25 { animation: t5fly25 1.5s 0.25s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p26 { animation: t5fly26 1.5s 0.3s ease-out forwards; font-size: 10px; }
    .zap-tier-5 .p27 { animation: t5fly27 1.5s 0.35s ease-out forwards; font-size: 12px; }
    .zap-tier-5 .p28 { animation: t5fly28 1.5s 0.4s ease-out forwards; font-size: 10px; }

    @keyframes t5fly1 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(-40px, -44px) scale(0.3); }
    }
    @keyframes t5fly2 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(40px, -42px) scale(0.3); }
    }
    @keyframes t5fly3 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(-38px, 42px) scale(0.3); }
    }
    @keyframes t5fly4 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(38px, 44px) scale(0.3); }
    }
    @keyframes t5fly5 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-46px, -10px) scale(0.2); }
    }
    @keyframes t5fly6 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(46px, 10px) scale(0.2); }
    }
    @keyframes t5fly7 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-12px, -48px) scale(0.2); }
    }
    @keyframes t5fly8 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(12px, 48px) scale(0.2); }
    }
    @keyframes t5fly9 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-26px, -46px) scale(0.2); }
    }
    @keyframes t5fly10 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(46px, -18px) scale(0.2); }
    }
    @keyframes t5fly11 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(26px, 46px) scale(0.2); }
    }
    @keyframes t5fly12 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(-46px, 18px) scale(0.2); }
    }
    @keyframes t5fly13 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-42px, -28px) scale(0.3); }
    }
    @keyframes t5fly14 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(20px, -46px) scale(0.3); }
    }
    @keyframes t5fly15 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(42px, 28px) scale(0.3); }
    }
    @keyframes t5fly16 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.9); }
      100% { opacity: 0; transform: translate(-20px, 46px) scale(0.3); }
    }
    @keyframes t5fly17 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(0, -50px) scale(0.2); }
    }
    @keyframes t5fly18 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.8); }
      100% { opacity: 0; transform: translate(0, 50px) scale(0.2); }
    }
    @keyframes t5fly19 {
      0% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
      100% { opacity: 0; transform: translate(-30px, -55px) scale(0.4) rotate(-30deg); }
    }
    @keyframes t5fly20 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(35px, -50px) scale(0.4); }
    }
    @keyframes t5fly21 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(0, -60px) scale(0.5); }
    }
    @keyframes t5fly22 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(50px, 0) scale(0.5); }
    }
    @keyframes t5fly23 {
      0% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
      100% { opacity: 0; transform: translate(30px, 55px) scale(0.4) rotate(30deg); }
    }
    @keyframes t5fly24 {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(-35px, 50px) scale(0.4); }
    }
    @keyframes t5fly25 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-50px, -20px) scale(0.2); }
    }
    @keyframes t5fly26 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(50px, -30px) scale(0.2); }
    }
    @keyframes t5fly27 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(50px, 20px) scale(0.2); }
    }
    @keyframes t5fly28 {
      0% { opacity: 1; transform: translate(0, 0) scale(0.7); }
      100% { opacity: 0; transform: translate(-50px, 30px) scale(0.2); }
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
  disabled = input<boolean>(false);

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
    if (!this.disabled() && !this.isHandset() && this.quickZapEnabled()) {
      this.showHoverMenu.set(true);
    }
  }

  onMouseLeave(): void {
    this.showHoverMenu.set(false);
  }

  // Mobile long-press handlers
  onTouchStart(event: TouchEvent): void {
    if (this.disabled() || !this.isHandset() || !isPlatformBrowser(this.platformId)) {
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
    if (this.disabled()) {
      return;
    }
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

    if (this.disabled() || this.isLoading()) {
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

    if (this.disabled()) {
      return;
    }

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
