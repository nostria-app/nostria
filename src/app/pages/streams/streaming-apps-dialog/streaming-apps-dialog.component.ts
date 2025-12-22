import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

interface StreamingApp {
  name: string;
  description: string;
  logo: string;
  links: {
    label: string;
    url: string;
    icon: string;
  }[];
}

@Component({
  selector: 'app-streaming-apps-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="streaming-apps-dialog">
      <h2 mat-dialog-title>
        <mat-icon>videocam</mat-icon>
        <span i18n="@@streams.dialog.title">Start Streaming on Nostr</span>
      </h2>

      <mat-dialog-content>
        <p class="description" i18n="@@streams.dialog.description">
          Choose a streaming app to broadcast live to the Nostr network. Your stream will be visible to everyone on Nostr!
        </p>

        <div class="apps-list">
          @for (app of apps; track app.name) {
            <mat-card class="app-card">
              <mat-card-header>
                <img mat-card-avatar [src]="app.logo" [alt]="app.name" class="app-logo">
                <mat-card-title>{{ app.name }}</mat-card-title>
                <mat-card-subtitle>{{ app.description }}</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <div class="app-links">
                  @for (link of app.links; track link.label) {
                    <a [href]="link.url" target="_blank" rel="noopener noreferrer" mat-stroked-button>
                      <mat-icon>{{ link.icon }}</mat-icon>
                      {{ link.label }}
                    </a>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close i18n="@@common.close">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .streaming-apps-dialog {
      min-width: 400px;
      max-width: 600px;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;

      mat-icon {
        color: var(--mat-sys-primary);
      }
    }

    .description {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }

    .apps-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .app-card {
      background: var(--mat-sys-surface-container);
      width: 100%;
    }

    .app-logo {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      object-fit: cover;
    }

    mat-card-header {
      margin-bottom: 0.5rem;
    }

    mat-card-content {
      padding-top: 0.5rem;
    }

    .app-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;

      a {
        text-decoration: none;
        
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }
    }

    mat-dialog-actions {
      padding: 1rem 0 0;
    }

    @media (max-width: 500px) {
      .streaming-apps-dialog {
        min-width: unset;
      }

      .app-links {
        flex-direction: column;

        a {
          width: 100%;
          justify-content: flex-start;
        }
      }
    }
  `]
})
export class StreamingAppsDialogComponent {
  apps: StreamingApp[] = [
    {
      name: 'Shosho',
      description: 'Stream directly from your mobile device',
      logo: 'logos/clients/shosho.png',
      links: [
        {
          label: 'Google Play',
          url: 'https://play.google.com/store/apps/details?id=com.shosho.app',
          icon: 'android'
        },
        {
          label: 'TestFlight',
          url: 'https://testflight.apple.com/join/Cg4Ng6dq',
          icon: 'apple'
        },
        {
          label: 'Zapstore',
          url: 'https://zapstore.dev/',
          icon: 'download'
        },
        {
          label: 'Obtainium',
          url: 'https://github.com/ImranR98/Obtainium',
          icon: 'download'
        }
      ]
    },
    {
      name: 'zap.stream',
      description: 'Professional streaming platform for Nostr',
      logo: 'logos/clients/zapstream.png',
      links: [
        {
          label: 'Web App',
          url: 'https://zap.stream',
          icon: 'language'
        },
        {
          label: 'Google Play',
          url: 'https://play.google.com/store/apps/details?id=io.nostrlabs.zap_stream_flutter',
          icon: 'android'
        },
        {
          label: 'App Store',
          url: 'https://testflight.apple.com/join/5Qh7mfvU',
          icon: 'apple'
        },
        {
          label: 'Obtainium',
          url: 'https://github.com/nostrlabs-io/zap-stream-flutter',
          icon: 'download'
        }
      ]
    }
  ];
}
