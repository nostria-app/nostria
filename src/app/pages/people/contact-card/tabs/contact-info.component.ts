import { Component, inject, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrRecord } from '../../../../interfaces';
import { LoggerService } from '../../../../services/logger.service';
import { UtilitiesService } from '../../../../services/utilities.service';

interface ExternalIdentity {
  platform: string;
  identity: string;
  proof: string;
  displayName: string;
  icon: string;
  profileUrl: string | null;
  proofUrl: string | null;
  verified: boolean;
}

@Component({
  selector: 'app-contact-info',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatListModule,
    MatTooltipModule,
  ],
  templateUrl: './contact-info.component.html',
  styleUrl: './contact-info.component.scss',
})
export class ContactInfoComponent {
  pubkey = input.required<string>();
  metadata = input.required<NostrRecord>();

  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);

  externalIdentities = computed(() => this.parseExternalIdentities());

  private parseExternalIdentities(): ExternalIdentity[] {
    const metadata = this.metadata();
    const event = metadata.event;

    if (!event.tags) return [];

    const identities: ExternalIdentity[] = [];

    // Find all 'i' tags (NIP-39)
    const iTags = event.tags.filter(tag => tag[0] === 'i' && tag.length >= 2);

    for (const tag of iTags) {
      const platformIdentity = tag[1];
      const proof = tag[2] || '';

      // Split platform:identity
      const separatorIndex = platformIdentity.indexOf(':');
      if (separatorIndex === -1) continue;

      const platform = platformIdentity.substring(0, separatorIndex);
      const identity = platformIdentity.substring(separatorIndex + 1);

      const externalIdentity = this.buildExternalIdentity(platform, identity, proof);
      if (externalIdentity) {
        identities.push(externalIdentity);
      }
    }

    return identities;
  }

  private isUrl(str: string): boolean {
    return str.startsWith('http://') || str.startsWith('https://');
  }

  private buildProofUrl(proof: string, fallbackUrl: string): string | null {
    if (!proof) return null;
    return this.isUrl(proof) ? proof : fallbackUrl;
  }

  private buildExternalIdentity(
    platform: string,
    identity: string,
    proof: string
  ): ExternalIdentity | null {
    const platformLower = platform.toLowerCase();

    switch (platformLower) {
      case 'github':
        return {
          platform: 'GitHub',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'code',
          profileUrl: `https://github.com/${identity}`,
          proofUrl: this.buildProofUrl(proof, `https://gist.github.com/${identity}/${proof}`),
          verified: !!proof,
        };

      case 'twitter':
      case 'x':
        return {
          platform: 'X (Twitter)',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'alternate_email',
          profileUrl: `https://twitter.com/${identity}`,
          proofUrl: this.buildProofUrl(proof, `https://twitter.com/${identity}/status/${proof}`),
          verified: !!proof,
        };

      case 'mastodon': {
        // Identity format: instance/@username
        const mastodonUrl = `https://${identity}`;
        return {
          platform: 'Mastodon',
          identity,
          proof,
          displayName: `@${identity.split('/@')[1] || identity}`,
          icon: 'rss_feed',
          profileUrl: mastodonUrl,
          proofUrl: this.buildProofUrl(proof, `${mastodonUrl}/${proof}`),
          verified: !!proof,
        };
      }

      case 'telegram':
        return {
          platform: 'Telegram',
          identity,
          proof,
          displayName: identity,
          icon: 'send',
          profileUrl: null,
          proofUrl: this.buildProofUrl(proof, `https://t.me/${proof}`),
          verified: !!proof,
        };

      case 'linkedin':
        return {
          platform: 'LinkedIn',
          identity,
          proof,
          displayName: identity,
          icon: 'business',
          profileUrl: `https://linkedin.com/in/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'facebook':
        return {
          platform: 'Facebook',
          identity,
          proof,
          displayName: identity,
          icon: 'people',
          profileUrl: `https://facebook.com/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'instagram':
        return {
          platform: 'Instagram',
          identity,
          proof,
          displayName: `@${identity}`,
          icon: 'photo_camera',
          profileUrl: `https://instagram.com/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      case 'reddit':
        return {
          platform: 'Reddit',
          identity,
          proof,
          displayName: `u/${identity}`,
          icon: 'forum',
          profileUrl: `https://reddit.com/user/${identity}`,
          proofUrl: null,
          verified: !!proof,
        };

      default:
        return {
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          identity,
          proof,
          displayName: identity,
          icon: 'link',
          profileUrl: null,
          proofUrl: this.isUrl(proof) ? proof : null,
          verified: !!proof,
        };
    }
  }

  copyToClipboard(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.logger.debug(`${label} copied to clipboard`),
      err => this.logger.error(`Failed to copy ${label}:`, err)
    );
  }

  getNpub(): string {
    return this.utilities.getNpubFromPubkey(this.pubkey()) || this.pubkey();
  }

  getAbout(): string {
    const metadata = this.metadata();
    return (metadata.data.about as string) || '';
  }

  getWebsite(): string | null {
    const metadata = this.metadata();
    return (metadata.data.website as string) || null;
  }

  getLud16(): string | null {
    const metadata = this.metadata();
    return (metadata.data.lud16 as string) || null;
  }

  getNip05(): string | null {
    const metadata = this.metadata();
    return (metadata.data.nip05 as string) || null;
  }
}
