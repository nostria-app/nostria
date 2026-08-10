import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { RouterLink } from '@angular/router';

interface ChatOption {
  path: string;
  icon: string;
  title: string;
  description: string;
  variant: 'public' | 'groups' | 'private';
}

/** Landing page that lets the user pick between the three chat surfaces. */
@Component({
  selector: 'app-chats-hub',
  imports: [MatIconModule, MatRippleModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chats-hub">
      <header class="hub-header">
        <h1 i18n="@@chats.hub.title">Chats</h1>
        <p i18n="@@chats.hub.subtitle">Pick how you want to talk with others.</p>
      </header>

      <div class="hub-grid">
        @for (option of options; track option.path) {
          <a [routerLink]="option.path" class="hub-tile" [class]="'variant-' + option.variant" mat-ripple>
            <mat-icon class="tile-icon">{{ option.icon }}</mat-icon>
            <div class="tile-text">
              <h2>{{ option.title }}</h2>
              <p>{{ option.description }}</p>
            </div>
            <mat-icon class="tile-arrow">arrow_forward</mat-icon>
          </a>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .chats-hub {
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 16px 48px;
    }

    .hub-header {
      margin-bottom: 24px;

      h1 {
        margin: 0 0 4px;
        font-size: 1.75rem;
      }

      p {
        margin: 0;
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .hub-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }

    .hub-tile {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px;
      border-radius: var(--mat-sys-corner-large);
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
      text-decoration: none;
      transition:
        border-color 0.2s ease,
        transform 0.2s ease,
        box-shadow 0.2s ease;

      &:hover {
        border-color: var(--mat-sys-primary);
        transform: translateY(-2px);
        box-shadow: var(--mat-sys-level2);
      }

      .tile-icon {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        font-size: 44px;
        color: var(--mat-sys-primary);
      }

      .tile-text {
        flex: 1;
        min-width: 0;
      }

      h2 {
        margin: 0 0 2px;
        font-size: 1.05rem;
      }

      p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--mat-sys-on-surface-variant);
      }

      .tile-arrow {
        flex: 0 0 auto;
        color: var(--mat-sys-on-surface-variant);
        opacity: 0.6;
      }
    }

    .variant-groups .tile-icon {
      color: var(--mat-sys-secondary);
    }

    .variant-private .tile-icon {
      color: var(--mat-sys-tertiary);
    }
  `,
})
export class ChatsHubComponent {
  readonly options: ChatOption[] = [
    {
      path: '/chats/public',
      icon: 'forum',
      title: $localize`:@@chats.hub.public.title:Public`,
      description: $localize`:@@chats.hub.public.description:Open channels anyone can read and join (NIP-28).`,
      variant: 'public',
    },
    {
      path: '/chats/servers',
      icon: 'groups',
      title: $localize`:@@chats.hub.groups.title:Groups`,
      description: $localize`:@@chats.hub.groups.description:Relay hosted communities with moderation (NIP-29).`,
      variant: 'groups',
    },
    {
      path: '/c',
      icon: 'lock',
      title: $localize`:@@chats.hub.private.title:Private`,
      description: $localize`:@@chats.hub.private.description:End-to-end encrypted communities only members can read.`,
      variant: 'private',
    },
  ];
}
