import { Component, inject, signal, effect, untracked, computed, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { nip19 } from 'nostr-tools';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { NostrRecord } from '../../interfaces';

/** Represents a parsed external identity from NIP-39 `i` tags */
export interface ExternalIdentity {
  /** Platform name (e.g. github, twitter, mastodon, telegram) */
  platform: string;
  /** Identity on the platform (username, user ID, etc.) */
  identity: string;
  /** Proof string (Gist ID, Tweet ID, post ID, etc.) */
  proof?: string;
  /** Display name derived from platform */
  displayName: string;
  /** URL to the proof content */
  proofUrl?: string;
  /** URL to the identity's profile page */
  profileUrl?: string;
  /** Material icon name for the platform */
  icon: string;
  /** Verification status */
  verificationStatus: 'pending' | 'verifying' | 'verified' | 'failed' | 'unverifiable';
  /** Verification error message */
  verificationError?: string;
}

@Component({
  selector: 'app-user-links',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './user-links.component.html',
  styleUrl: './user-links.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserLinksComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  layout = inject(LayoutService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private panelNav = inject(PanelNavigationService);

  isLoading = signal(true);
  error = signal<string | null>(null);
  viewingPubkey = signal<string>('');
  viewingProfile = signal<NostrRecord | undefined>(undefined);
  identities = signal<ExternalIdentity[]>([]);
  autoVerifyTriggered = signal(false);
  private hasInitialData = signal(false);

  identityCount = computed(() => this.identities().length);

  constructor() {
    let pubkeyParam = this.route.snapshot.paramMap.get('pubkey');
    if (pubkeyParam) {
      pubkeyParam = this.utilities.safeGetHexPubkey(pubkeyParam) || pubkeyParam;
      this.viewingPubkey.set(pubkeyParam);
    }

    const historyState = typeof window !== 'undefined' ? history.state : null;
    const navState = (this.router.getCurrentNavigation()?.extras.state ?? historyState) as {
      profile?: unknown;
    } | null;
    const preloadedProfile = this.asNostrRecord(navState?.profile);

    if (preloadedProfile) {
      this.viewingProfile.set(preloadedProfile);
      const parsed = this.parseIdentityTags(preloadedProfile.event.tags || []);
      this.identities.set(parsed);
      this.hasInitialData.set(true);
      this.isLoading.set(false);

      if (parsed.length > 0 && !this.autoVerifyTriggered()) {
        this.autoVerifyTriggered.set(true);
        this.verifyAll();
      }
    }

    effect(() => {
      const pubkey = this.viewingPubkey();
      if (pubkey) {
        untracked(() => this.loadData(pubkey));
      }
    });
  }

  private async loadData(pubkey: string): Promise<void> {
    try {
      if (!this.hasInitialData()) {
        this.isLoading.set(true);
      }
      this.error.set(null);

      const profile = await this.dataService.getProfile(pubkey);
      this.viewingProfile.set(profile);

      if (profile?.event?.tags) {
        const parsed = this.parseIdentityTags(profile.event.tags);
        this.identities.set(parsed);

        // Auto-verify all identities that have proofs
        if (!this.autoVerifyTriggered()) {
          this.autoVerifyTriggered.set(true);
          this.verifyAll();
        }
      } else {
        this.identities.set([]);
      }

      this.isLoading.set(false);
    } catch (err) {
      if (!this.hasInitialData()) {
        this.error.set('Failed to load external identities');
      }
      this.isLoading.set(false);
      this.logger.error('Error loading identity data', err);
    }
  }

  private asNostrRecord(value: unknown): NostrRecord | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Partial<NostrRecord>;
    if (!record.event || typeof record.event !== 'object') {
      return null;
    }

    const event = record.event as { tags?: unknown };
    if (!Array.isArray(event.tags)) {
      return null;
    }

    return value as NostrRecord;
  }

  private parseIdentityTags(tags: string[][]): ExternalIdentity[] {
    const results: ExternalIdentity[] = [];

    for (const tag of tags) {
      if (tag[0] !== 'i' || !tag[1]) continue;

      const platformIdentity = tag[1];
      const proof = tag[2] || undefined;

      const colonIndex = platformIdentity.indexOf(':');
      if (colonIndex === -1) continue;

      const platform = platformIdentity.substring(0, colonIndex).toLowerCase();
      const identity = platformIdentity.substring(colonIndex + 1);

      const canVerify = this.canVerifyPlatform(platform);
      results.push({
        platform,
        identity,
        proof,
        displayName: this.getPlatformDisplayName(platform),
        proofUrl: this.getProofUrl(platform, identity, proof),
        profileUrl: this.getProfileUrl(platform, identity),
        icon: this.getPlatformIcon(platform),
        verificationStatus: !proof ? 'unverifiable' : canVerify ? 'pending' : 'unverifiable',
        verificationError: !proof ? 'No proof provided' : canVerify ? undefined : 'No public API available for verification',
      });
    }

    return results;
  }

  private getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      github: 'GitHub',
      twitter: 'X (Twitter)',
      mastodon: 'Mastodon',
      telegram: 'Telegram',
      youtube: 'YouTube',
      facebook: 'Facebook',
      reddit: 'Reddit',
      linkedin: 'LinkedIn',
      keybase: 'Keybase',
      instagram: 'Instagram',
      bluesky: 'Bluesky',
    };
    return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
  }

  private getPlatformIcon(platform: string): string {
    const icons: Record<string, string> = {
      github: 'code',
      twitter: 'alternate_email',
      mastodon: 'forum',
      telegram: 'send',
      youtube: 'smart_display',
      facebook: 'group',
      reddit: 'reddit',
      linkedin: 'work',
      keybase: 'key',
      instagram: 'photo_camera',
      bluesky: 'cloud',
    };
    return icons[platform] || 'link';
  }

  private getProofUrl(platform: string, identity: string, proof?: string): string | undefined {
    if (!proof) return undefined;

    switch (platform) {
      case 'github':
        return `https://gist.github.com/${identity}/${proof}`;
      case 'twitter':
        return `https://twitter.com/${identity}/status/${proof}`;
      case 'mastodon':
        return `https://${identity}/${proof}`;
      case 'telegram':
        return `https://t.me/${proof}`;
      case 'facebook':
        return `https://facebook.com${proof.startsWith('/') ? '' : '/'}${proof}`;
      default:
        return undefined;
    }
  }

  private getProfileUrl(platform: string, identity: string): string | undefined {
    switch (platform) {
      case 'github':
        return `https://github.com/${identity}`;
      case 'twitter':
        return `https://twitter.com/${identity}`;
      case 'mastodon':
        return `https://${identity}`;
      case 'telegram':
        // Telegram user IDs don't have a direct URL
        return undefined;
      case 'youtube':
        return `https://youtube.com/@${identity}`;
      case 'reddit':
        return `https://reddit.com/u/${identity}`;
      case 'linkedin':
        return `https://linkedin.com/in/${identity}`;
      case 'bluesky':
        return `https://bsky.app/profile/${identity}`;
      case 'facebook':
        return `https://facebook.com/${identity}`;
      case 'instagram':
        return `https://instagram.com/${identity}`;
      case 'keybase':
        return `https://keybase.io/${identity}`;
      default:
        return undefined;
    }
  }

  getProfileDisplayName(): string {
    const profile = this.viewingProfile();
    if (!profile) return 'User';
    if (profile.data?.display_name) return profile.data.display_name;
    if (profile.data?.name) return profile.data.name;
    if (profile.data?.nip05) return this.utilities.parseNip05(profile.data.nip05) || 'User';
    return 'User';
  }

  /** Verify all identities with proofs */
  verifyAll(): void {
    const current = this.identities();
    for (let i = 0; i < current.length; i++) {
      if (current[i].proof && current[i].verificationStatus === 'pending') {
        this.verifyIdentity(i);
      }
    }
  }

  /** Verify a single identity by index */
  async verifyIdentity(index: number): Promise<void> {
    const current = this.identities();
    const identity = current[index];
    if (!identity || !identity.proof) return;

    // Set status to verifying
    this.updateIdentityStatus(index, 'verifying');

    try {
      const pubkey = this.viewingPubkey();
      const npub = nip19.npubEncode(pubkey);
      const verified = await this.fetchAndVerifyProof(identity, npub);

      if (verified) {
        this.updateIdentityStatus(index, 'verified');
      } else {
        this.updateIdentityStatus(index, 'failed', 'Proof content does not match expected format');
      }
    } catch (err) {
      this.logger.error(`Verification failed for ${identity.platform}:${identity.identity}`, err);
      this.updateIdentityStatus(index, 'failed', 'Could not reach proof URL');
    }
  }

  private updateIdentityStatus(
    index: number,
    status: ExternalIdentity['verificationStatus'],
    error?: string
  ): void {
    const current = [...this.identities()];
    if (current[index]) {
      current[index] = {
        ...current[index],
        verificationStatus: status,
        verificationError: error,
      };
      this.identities.set(current);
    }
  }

  private async fetchAndVerifyProof(identity: ExternalIdentity, npub: string): Promise<boolean> {
    const { platform, identity: id, proof } = identity;
    if (!proof) return false;

    switch (platform) {
      case 'github':
        return this.verifyGitHub(id, proof, npub);
      case 'mastodon':
        return this.verifyMastodon(id, proof, npub);
      default:
        // Platforms without public APIs cannot be verified
        return false;
    }
  }

  private async verifyGitHub(username: string, gistId: string, npub: string): Promise<boolean> {
    try {
      const url = `https://api.github.com/gists/${gistId}`;
      const response = await fetch(url);
      if (!response.ok) return false;

      const gist = await response.json();

      // Check that the gist owner matches the claimed username
      if (gist.owner?.login?.toLowerCase() !== username.toLowerCase()) return false;

      // Check gist file content for the npub
      const files = gist.files;
      if (!files) return false;

      for (const file of Object.values(files) as { content?: string }[]) {
        const content = file.content || '';
        if (content.includes(npub)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async verifyMastodon(instanceAndUser: string, postId: string, npub: string): Promise<boolean> {
    try {
      // identity format: instance/@username
      // The proof URL is https://<identity>/<proof>
      // We can try to fetch the Mastodon post via the API
      const parts = instanceAndUser.split('/@');
      if (parts.length < 2) return false;

      const instance = parts[0];
      // The postId in NIP-39 is the status ID number
      const apiUrl = `https://${instance}/api/v1/statuses/${postId}`;
      const response = await fetch(apiUrl);
      if (!response.ok) return false;

      const status = await response.json();
      const content = status.content || '';

      // Mastodon returns HTML content, check for npub in it
      return content.includes(npub);
    } catch {
      return false;
    }
  }

  /** Platforms that have public APIs we can verify against */
  private canVerifyPlatform(platform: string): boolean {
    return ['github', 'mastodon'].includes(platform);
  }

  getVerificationIcon(status: ExternalIdentity['verificationStatus']): string {
    switch (status) {
      case 'verified': return 'verified';
      case 'verifying': return 'sync';
      case 'failed': return 'error_outline';
      case 'pending': return 'schedule';
      case 'unverifiable': return 'link';
      default: return 'help_outline';
    }
  }

  getVerificationTooltip(identity: ExternalIdentity): string {
    switch (identity.verificationStatus) {
      case 'verified': return 'Identity verified';
      case 'verifying': return 'Verifying...';
      case 'failed': return identity.verificationError || 'Verification failed';
      case 'pending': return 'Verification pending';
      case 'unverifiable': return 'Cannot be verified automatically';
      default: return '';
    }
  }

  getVerificationClass(status: ExternalIdentity['verificationStatus']): string {
    switch (status) {
      case 'verified': return 'status-verified';
      case 'verifying': return 'status-verifying';
      case 'failed': return 'status-failed';
      case 'pending': return 'status-pending';
      case 'unverifiable': return 'status-unverifiable';
      default: return '';
    }
  }

  openProof(identity: ExternalIdentity, event: Event): void {
    event.stopPropagation();
    if (identity.proofUrl) {
      window.open(identity.proofUrl, '_blank', 'noopener,noreferrer');
    }
  }

  openProfile(identity: ExternalIdentity, event: Event): void {
    event.stopPropagation();
    if (identity.profileUrl) {
      window.open(identity.profileUrl, '_blank', 'noopener,noreferrer');
    }
  }

  goBack(): void {
    const isInRightPanel = this.route.outlet === 'right';
    if (isInRightPanel) {
      this.panelNav.goBackRight();
      return;
    }
    this.location.back();
  }
}
