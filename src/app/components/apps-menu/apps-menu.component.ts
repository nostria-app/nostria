import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';
import { AccountStateService } from '../../services/account-state.service';
import { InstallService } from '../../services/install.service';
import { MediaPlayerService } from '../../services/media-player.service';

interface MenuItem {
  icon: string;
  label: string;
  action?: () => void;
  route?: string[] | (() => string[]);
  hideWhenNotAuthenticated?: boolean;
  requiresSubscription?: boolean;
  requiresFeature?: string;
  showInstallCheck?: boolean;
}

@Component({
  selector: 'app-apps-menu',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './apps-menu.component.html',
  styleUrl: './apps-menu.component.scss',
})
export class AppsMenuComponent {
  private router = inject(Router);
  private app = inject(ApplicationService);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);
  private accountState = inject(AccountStateService);
  private installService = inject(InstallService);
  private mediaPlayerService = inject(MediaPlayerService);

  closed = output<void>();

  createItems: MenuItem[] = [
    {
      icon: 'create',
      label: 'Create Note',
      action: () => this.eventService.createNote(),
      hideWhenNotAuthenticated: true,
    },
    {
      icon: 'article',
      label: 'Write Article',
      action: () => this.layout.createArticle(),
      hideWhenNotAuthenticated: true,
    },
    {
      icon: 'upload',
      label: 'Upload',
      action: () => this.layout.uploadMedia(),
      hideWhenNotAuthenticated: true,
    },
  ];

  contentItems: MenuItem[] = [
    { icon: 'edit_document', label: 'Drafts', route: ['/article/drafts'] },
    { icon: 'lists', label: 'Lists', route: ['/lists'] },
    { icon: 'poll', label: 'Polls', route: ['/polls'] },
  ];

  mediaItems: MenuItem[] = [
    { icon: 'playlist_play', label: 'Playlists', route: ['/playlists'] },
    { icon: 'queue_music', label: 'Media Queue', route: ['/media-queue'] },
    // { icon: 'dock_to_bottom', label: 'Media Player', action: () => this.toggleMediaPlayer() },
    { icon: 'live_tv', label: 'Live Streams', route: ['/streams'] },
    { icon: 'adaptive_audio_mic', label: 'Live Meetings', route: ['/meetings'] },
  ];

  moreItems: MenuItem[] = [
    {
      icon: 'calendar_month',
      label: 'Calendar',
      route: ['/calendar'],
      requiresFeature: 'preview',
    },
        {
      icon: 'bookmarks',
      label: 'Bookmarks',
      route: ['/bookmarks'],
    },
    {
      icon: 'note_stack',
      label: 'Notes',
      route: ['/notes'],
      requiresSubscription: true,
    },
    {
      icon: 'badge',
      label: 'Badges',
      route: () => ['p', this.accountState.pubkey(), 'badges'] as string[],
    },
    {
      icon: 'publish',
      label: 'Publish Event',
      action: () => this.layout.openPublishCustomEvent(),
    },
    {
      icon: 'download',
      label: 'Install App',
      action: () => this.openInstallDialog(),
      showInstallCheck: true,
    },
  ];

  getCreateItems(): MenuItem[] {
    return this.createItems.filter(item => {
      if (item.hideWhenNotAuthenticated && !this.app.authenticated()) return false;
      return true;
    });
  }

  getMoreItems(): MenuItem[] {
    return this.moreItems.filter(item => {
      if (item.requiresFeature) {
        // Type assertion needed as the feature string may not match FeatureLevel enum
        const enabled = this.app.enabledFeature(item.requiresFeature as 'preview' | 'beta');
        if (!enabled) return false;
      }
      if (item.requiresSubscription && !this.accountState.hasActiveSubscription()) return false;
      if (item.showInstallCheck && !this.installService.shouldShowInstallOption()) return false;
      return true;
    });
  }

  onItemClick(item: MenuItem): void {
    if (item.action) {
      item.action();
    } else if (item.route) {
      const route = typeof item.route === 'function' ? item.route() : item.route;
      this.router.navigate(route);
    }
    this.closed.emit();
  }

  private toggleMediaPlayer(): void {
    this.layout.showMediaPlayer.set(!this.layout.showMediaPlayer());
  }

  private openInstallDialog(): void {
    this.installService.openInstallDialog();
  }
}
