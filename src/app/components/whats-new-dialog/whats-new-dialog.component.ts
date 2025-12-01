import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';

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
        <button mat-flat-button [mat-dialog-close]="true">Got it!</button>
      </div>
    </div>
  `,
  styleUrl: './whats-new-dialog.component.scss',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    NgOptimizedImage
],
})
export class WhatsNewDialogComponent {
  private dialogRef = inject(MatDialogRef<WhatsNewDialogComponent>);

  // Sample updates - replace with real data
  updates: FeatureUpdate[] = [
    {
      version: '1.1.0',
      date: 'November 2025',
      title: 'Major update',
      description: 'Notifications, Publishing, Feeds, Lists, Polls, Badges.',
      features: [
        {
          title: 'Notifications',
          description:
            'Comprehensive notification system with support for activity notifications, content notifications, and relay publishing status. Configure which types of notifications you want to receive in the settings.',
        },
        {
          title: 'Publishing',
          description:
            'Enhanced publishing experience with real-time relay publishing status. Track which relays successfully received your events and identify any failures immediately.',
        },
        {
          title: 'Feeds',
          description:
            'Improved feed management with better performance and caching. Create custom feeds with multiple columns, configure filters, and organize your content exactly how you want.',
        },
        {
          title: 'Lists',
          description:
            'Full support for creating and managing Nostr lists. Organize people, content, and references into curated collections that can be shared and followed by others.',
        },
        {
          title: 'Polls',
          description:
            'Create and participate in polls directly within Nostria. View poll results in real-time and see how the community votes on various topics.',
        },
        {
          title: 'Badges',
          description:
            'Browse, create, and award badges to recognize community members. View all your earned badges on your profile and discover new badges to collect.',
        },
        {
          title: 'Trust',
          description:
            'New option in settings that is enabled by default, will retrieve the trust score for each profile within the app.',
        },
      ],
    },
    {
      version: '1.0.8',
      date: 'October 2025',
      title: 'Many new features',
      description: 'Proof-of-Work on notes, and lots more',
      features: [
        {
          title: 'Enable proof of work in the advanced options',
          description:
            'You can now enable proof of work for your notes in the advanced options, this will be applied every time you post.',
        },
      ],
    },
    {
      version: '1.0.7',
      date: 'October 2025',
      title: 'Quality of Life Improvements',
      description: 'Full screen media viewer, file upload options for new Notes and more.',
      features: [
        {
          title: 'Media Player Fullscreen',
          description:
            'From the media player on the bottom bar, you can now enter fullscreen mode for an immersive experience when watching videos.',
          screenshots: [
            {
              src: '/screenshots/2025-10-13-media-player-fullscreen.jpg',
              alt: 'Media Player Fullscreen',
              width: 1193,
              height: 914,
            },
          ],
        },
        {
          title: 'Post options',
          description:
            'There are now an option to upload files as originals in the Post dialog. This is useful when uploading videos that cannot be transcoded. Any errors that occurs after uploading, will also be displayed in the dialog.',
          screenshots: [
            {
              src: '/screenshots/2025-10-13-post-options.jpg',
              alt: 'Post options',
              width: 540,
              height: 656,
            },
          ],
        },
        {
          title: 'Add Person',
          description:
            'You can already search for people from the search bar. Now there is also an "Add Person" button in the People section, making it even easier to find and follow new people.',
          screenshots: [
            {
              src: '/screenshots/2025-10-14-people-add-person.jpg',
              alt: 'Search Person',
              width: 963,
              height: 682,
            }, {
              src: '/screenshots/2025-10-14-people-add-person-follow.jpg',
              alt: 'Follow Person',
              width: 654,
              height: 412,
            },
          ],
        },
      ],
    },
    {
      version: '1.0.6',
      date: 'October 2025',
      title: 'Relay resources optimization',
      description: 'Some great new features and optimizations to reduce resource usage.',
      features: [
        {
          title: 'Event mentions preview',
          description:
            'When an event is mentioned in a note, a preview of that event is shown directly in the content. This provides context and makes it easier to understand the reference without needing to navigate away.',
          screenshots: [
            {
              src: '/screenshots/2025-10-06-event-mention.png',
              alt: 'Event mentions preview',
              width: 523,
              height: 270,
            },
          ],
        },
        {
          title: 'Relay resources optimization',
          description:
            'Optimized the way relay resources are managed and utilized, reducing resources usage on the device and improving overall performance.',
        },
      ],
    },
    {
      version: '1.0.5',
      date: 'October 2025',
      title: 'Playlists',
      description: 'You can now create and manage playlists.',
      features: [
        {
          title: 'Playlist editing',
          description:
            'You can now create and manage playlists.',
          screenshots: [
            {
              src: '/screenshots/2025-10-05-playlist.png',
              alt: 'Playlist editing',
              width: 971,
              height: 1168,
            },
          ],
        },
        {
          title: 'Playlist feed view',
          description:
            'The playlist that is shown in feeds has been improved, with better name display and the download button.',
          screenshots: [
            {
              src: '/screenshots/2025-10-05-playlist-feed.png',
              alt: 'Playlist feed view',
              width: 687,
              height: 735,
            },
          ],
        },
        {
          title: 'Boards and Feeds',
          description:
            'Feeds and Columns has been renamed into Boards and Feeds for improved usability. Additionally, the boards are shown in the main menu if expanded.',
        },
        {
          title: 'Improvements and fixes',
          description:
            'Almost every day improvements and fixes are being made to enhance the overall user experience. These are deployed and available to you immediately to experience.',
        },
      ],
    },
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
          title: 'Feeds Columns custom profiles and Starter Packs',
          description:
            'Custom profiles and starter packs for feeds columns, allowing for more personalized content.',
          screenshots: [
            {
              src: '/screenshots/2025-09-24-feed-column-custom-profiles.png',
              alt: 'Custom profiles and starter packs for feeds columns',
              width: 954,
              height: 956,
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
