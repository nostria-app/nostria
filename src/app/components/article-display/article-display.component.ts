import { Component, computed, inject, input, output } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { DateToggleComponent } from '../date-toggle/date-toggle.component';
import { RepostButtonComponent } from '../event/repost-button/repost-button.component';
import { ReactionButtonComponent } from '../event/reaction-button/reaction-button.component';
import { EventMenuComponent } from '../event/event-menu/event-menu.component';
import { MentionHoverDirective } from '../../directives/mention-hover.directive';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { BookmarkService } from '../../services/bookmark.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

export interface ArticleData {
  event?: Event;
  title: string;
  summary: string;
  image: string;
  parsedContent: SafeHtml;
  hashtags: string[];
  authorPubkey: string;
  publishedAt: Date | null;
  publishedAtTimestamp: number;
  link: string;
  id: string;
  isJsonContent: boolean;
  jsonData: Record<string, unknown> | unknown[] | null;
}

@Component({
  selector: 'app-article-display',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    RouterModule,
    UserProfileComponent,
    DateToggleComponent,
    RepostButtonComponent,
    ReactionButtonComponent,
    EventMenuComponent,
    MentionHoverDirective,
    CommentsListComponent
],
  templateUrl: './article-display.component.html',
  styleUrl: './article-display.component.scss',
})
export class ArticleDisplayComponent {
  // Input for article data
  article = input.required<ArticleData>();

  // Display mode: 'full' shows everything, 'preview' hides author, comments, some actions
  mode = input<'full' | 'preview'>('full');

  // Text-to-speech inputs (only used in full mode)
  isSpeaking = input<boolean>(false);
  isPaused = input<boolean>(false);
  isSynthesizing = input<boolean>(false);
  useAiVoice = input<boolean>(false);
  isTranslating = input<boolean>(false);

  // Text-to-speech outputs (only used in full mode)
  startSpeech = output<void>();
  pauseSpeech = output<void>();
  resumeSpeech = output<void>();
  stopSpeech = output<void>();
  toggleAiVoice = output<boolean>();
  share = output<void>();
  translate = output<string>();

  layout = inject(LayoutService);

  // Services
  bookmark = inject(BookmarkService);
  accountState = inject(AccountStateService);

  // Computed properties for convenience
  event = computed(() => this.article().event);
  title = computed(() => this.article().title);
  summary = computed(() => this.article().summary);
  image = computed(() => this.article().image);
  parsedContent = computed(() => this.article().parsedContent);
  hashtags = computed(() => this.article().hashtags);
  authorPubkey = computed(() => this.article().authorPubkey);
  publishedAtTimestamp = computed(() => this.article().publishedAtTimestamp);
  link = computed(() => this.article().link);
  id = computed(() => this.article().id);
  isJsonContent = computed(() => this.article().isJsonContent);
  jsonData = computed(() => this.article().jsonData);

  /**
   * Get keys from an object for template iteration
   */
  getObjectKeys(obj: unknown): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  /**
   * Get value from object by key
   */
  getObjectValue(obj: unknown, key: string): unknown {
    if (!obj || typeof obj !== 'object') return null;
    return (obj as Record<string, unknown>)[key];
  }

  /**
   * Format JSON value for display
   */
  formatJsonValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object') return 'Object';
    return String(value);
  }

  /**
   * Check if value is a primitive (string, number, boolean, null)
   */
  isPrimitive(value: unknown): boolean {
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }

  /**
   * Stringify complex values (objects/arrays) for display
   */
  stringifyValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}
