import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { CommonModule } from '@angular/common';
import { NgOptimizedImage } from '@angular/common';

interface FeatureUpdate {
  version: string;
  date: string;
  title: string;
  description: string;
  features: {
    title: string;
    description: string;
    screenshots?: {
      src: string;
      alt: string;
      width: number;
      height: number;
    }[];
  }[];
}

@Component({
  selector: 'app-whats-new-dialog',
  template: `
    <div class="whats-new-dialog">
      <div class="dialog-header">
        <h1 mat-dialog-title>
          <mat-icon>campaign</mat-icon>
          What's New in Nostria
        </h1>
        <button mat-icon-button [mat-dialog-close]="true" aria-label="Close dialog">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div mat-dialog-content class="dialog-content">
        @for (update of updates; track update.version) {
          <mat-card class="update-card">
            <mat-card-header>
              <mat-card-title>{{ update.title }}</mat-card-title>
              <mat-card-subtitle>
                Version {{ update.version }} • {{ update.date }}
              </mat-card-subtitle>
            </mat-card-header>

            <mat-card-content>
              <p class="update-description">{{ update.description }}</p>

              @for (feature of update.features; track feature.title) {
                <div class="feature-item">
                  <h3>{{ feature.title }}</h3>
                  <p>{{ feature.description }}</p>

                  @if (feature.screenshots && feature.screenshots.length > 0) {
                    <div class="screenshots-container">
                      @for (screenshot of feature.screenshots; track screenshot.src) {
                        <div class="screenshot-wrapper">
                          <img
                            [ngSrc]="screenshot.src"
                            [alt]="screenshot.alt"
                            [width]="screenshot.width"
                            [height]="screenshot.height"
                            loading="lazy"
                            class="feature-screenshot"
                            priority="false"
                          />
                        </div>
                        <p class="screenshot-description">{{ screenshot.alt }}</p>
                      }
                    </div>
                  }
                </div>

                @if (!$last) {
                  <mat-divider class="feature-divider"></mat-divider>
                }
              }
            </mat-card-content>
          </mat-card>
        }
      </div>

      <div mat-dialog-actions class="dialog-actions">
        <button mat-raised-button color="primary" [mat-dialog-close]="true">Got it!</button>
      </div>
    </div>
  `,
  styleUrl: './whats-new-dialog.component.scss',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    NgOptimizedImage,
  ],
})
export class WhatsNewDialogComponent {
  private dialogRef = inject(MatDialogRef<WhatsNewDialogComponent>);

  // Sample updates - replace with real data
  updates: FeatureUpdate[] = [
    {
      version: '1.0.4',
      date: 'September 2025',
      title: 'Loading improvements',
      description: 'Better loading indicators, better resolving events through fallbacks.',
      features: [
        {
          title: 'Feeds Columns loading view',
          description:
            'Improved loading view for feeds columns, providing better visual feedback while content is being loaded.',
          screenshots: [
            {
              src: '/screenshots/2025-09-22-feed-column-loading.png',
              alt: 'Improved loading view for feeds columns',
              width: 520,
              height: 700,
            },
          ],
        },
        {
          title: 'Profile image caching',
          description:
            'Profile images will be cached locally, maximum limit of 2000 and they are cached for 5 days.',
        },
      ],
    },
    {
      version: '1.0.3',
      date: 'September 2025',
      title: 'Zaps Support',
      description: 'Full support for Bitcoin Lightning Network Zaps has been added to Nostria.',
      features: [
        {
          title: 'Send Zaps with Nostr Wallet Connect',
          description:
            'Connect your Lightning wallet using Nostr Wallet Connect (NWC) and send zaps directly from Nostria. Supports Alby and other NWC-compatible wallets.',
          screenshots: [
            {
              src: '/screenshots/2025-09-12-zaps-send.png',
              alt: 'Send zaps using Nostr Wallet Connect integration',
              width: 576,
              height: 571,
            },
          ],
        },
        {
          title: 'Zap History & Management',
          description:
            'View all your zap activity in the dedicated Zap History page. Easily access it from the Wallets tab in your credentials.',
        },
        {
          title: 'Enhanced Zap Display',
          description:
            'Zaps on events now show sender profiles with avatars instead of just public keys. Zaps are automatically sorted by amount from highest to lowest for better visibility.',
          screenshots: [
            {
              src: '/screenshots/2025-09-12-zaps-and-reactions.png',
              alt: 'Enhanced zap display with user profiles and reactions dialog',
              width: 865,
              height: 907,
            },
          ],
        },
        {
          title: 'Real-time Zap Updates',
          description:
            'Receive real-time updates when new zaps are sent to your posts or profile. The zap displays update automatically without requiring a page refresh.',
        },
      ],
    },
    {
      version: '1.0.2',
      date: 'September 2025',
      title: 'Tweaks and Improvements',
      description: 'Smaller improvements with big impact. Many minor bug fixes everywhere.',
      features: [
        {
          title: 'Reply threads in Timeline',
          description:
            'The timeline feed on a user profile, now renders the event being replied to and the original post.',
          screenshots: [
            {
              src: '/screenshots/2025-09-11-timeline-replies.png',
              alt: 'Improved visuals for reply events in the timeline feed',
              width: 702,
              height: 716,
            },
          ],
        },
      ],
    },
    {
      version: '1.0.1',
      date: 'September 2025',
      title: 'Enhanced User Experience',
      description: "We've added several new features to make your Nostria experience even better.",
      features: [
        {
          title: 'Simplified Feeds Interface',
          description:
            'The feeds interface has been simplified for smaller screens and mobile devices. This update takes up much less screen space and is quicker and easier to navigate and understand.',
          screenshots: [
            {
              src: '/screenshots/2025-08-31-feeds-and-columns.png',
              alt: 'Before: Original feeds interface with two rows for controls',
              width: 522,
              height: 225,
            },
            {
              src: '/screenshots/2025-09-01-feeds-and-columns.png',
              alt: 'After: Simplified feeds interface showing the new compact design',
              width: 524,
              height: 257,
            },
          ],
        },
        {
          title: 'Starter Packs Event Type',
          description: 'Nostria can now display Starter Packs event types.',
          screenshots: [
            {
              src: '/screenshots/2025-09-02-starter-packs.jpg',
              alt: 'Starter Packs event type displayed in the interface',
              width: 699,
              height: 807,
            },
          ],
        },
        {
          title: 'Performance Improvements',
          description:
            'We have done various performance optimizations to make the app faster and more responsive. We will continue to add more improvements in future updates.',
        },
        {
          title: 'Thread Sorting',
          description:
            'Replies to a post are now sorted by latest activity on the first level. Replies to replies are sorted from oldest to newest.',
        },
      ],
    },
    {
      version: '1.0.0',
      date: 'August 2025',
      title: 'First Release',
      description: 'After a period of public beta, the first release of Nostria is here!',
      features: [
        {
          title: 'Rich set of features',
          description:
            'In the initial release of Nostria, there is already a rich set of features. Publishing Notes, Articles, Media, Badges and more. Ability to have multiple feeds and columns. The People section to explore the people you care about. Many options for login, very easy signup for new users. Premium features. Music and Video player. Backup features. Notifications, bookmarks, messages and a lot more.',
        },
      ],
    },
  ];

  close(): void {
    this.dialogRef.close();
  }
}
