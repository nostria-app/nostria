import { Component, computed, inject, input, output } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { Event } from 'nostr-tools';
import { ContentComponent } from '../content/content.component';
import { EventHeaderComponent } from '../event/header/header.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventMenuComponent } from '../event/event-menu/event-menu.component';
import { EventService } from '../../services/event';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { NostrRecord } from '../../interfaces';

// Re-export CommentThread for recursive template usage
export interface CommentThread {
  comment: NostrRecord;
  replies: CommentThread[];
  depth: number;
}

interface CommentTags {
  // Root scope (uppercase tags)
  rootScopeTag: string | null; // A, E, or I
  rootScopeValue: string | null;
  rootScopeRelay: string | null;
  rootScopePubkey: string | null;
  rootKind: string | null; // K tag value
  rootAuthor: string | null; // P tag value

  // Parent scope (lowercase tags)
  parentScopeTag: string | null; // a, e, or i
  parentScopeValue: string | null;
  parentScopeRelay: string | null;
  parentScopePubkey: string | null;
  parentKind: string | null; // k tag value
  parentAuthor: string | null; // p tag value
}

@Component({
  selector: 'app-comment',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    ContentComponent,
    EventHeaderComponent,
    MatTooltipModule,
    EventMenuComponent
  ],
  templateUrl: './comment.component.html',
  styleUrl: './comment.component.scss',
})
export class CommentComponent {
  event = input.required<Event>();
  nested = input<boolean>(false);
  rootEvent = input.required<Event>(); // The original event being commented on
  replies = input<CommentThread[]>([]); // Nested replies to this comment
  depth = input<number>(0); // Nesting depth for styling

  // Output event when a reply is added
  replyAdded = output<Event>();

  private eventService = inject(EventService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);

  // Maximum nesting depth for visual indentation (after this, no more indent)
  readonly maxVisualDepth = 4;

  // Expose Math for template
  protected readonly Math = Math;

  // Parse NIP-22 comment tags
  commentTags = computed(() => this.parseCommentTags(this.event()));

  // Check if this is a top-level comment (root and parent are the same)
  isTopLevelComment = computed(() => {
    const tags = this.commentTags();
    return tags.rootScopeValue === tags.parentScopeValue;
  });

  // Get the comment content
  commentContent = computed(() => {
    const event = this.event();
    return event.content || '';
  });

  async onReply(): Promise<void> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    // Open comment dialog to reply to this comment
    const dialogRef = this.eventService.createCommentReply(this.rootEvent(), this.event());

    // Handle dialog result and emit the new reply event
    dialogRef.afterClosed().subscribe((result: { published: boolean; event?: Event } | undefined) => {
      if (result?.published && result.event) {
        this.replyAdded.emit(result.event);
      }
    });
  }

  private parseCommentTags(event: Event): CommentTags {
    const tags = event.tags;

    // Find root scope tags (uppercase)
    const rootATag = tags.find((tag) => tag[0] === 'A');
    const rootETag = tags.find((tag) => tag[0] === 'E');
    const rootITag = tags.find((tag) => tag[0] === 'I');
    const rootKTag = tags.find((tag) => tag[0] === 'K');
    const rootPTag = tags.find((tag) => tag[0] === 'P');

    // Find parent scope tags (lowercase)
    const parentATag = tags.find((tag) => tag[0] === 'a');
    const parentETag = tags.find((tag) => tag[0] === 'e');
    const parentITag = tags.find((tag) => tag[0] === 'i');
    const parentKTag = tags.find((tag) => tag[0] === 'k');
    const parentPTag = tags.find((tag) => tag[0] === 'p');

    // Determine which root scope tag is used
    let rootScopeTag: string | null = null;
    let rootScopeValue: string | null = null;
    let rootScopeRelay: string | null = null;
    let rootScopePubkey: string | null = null;

    if (rootATag) {
      rootScopeTag = 'A';
      rootScopeValue = rootATag[1] || null;
      rootScopeRelay = rootATag[2] || null;
    } else if (rootETag) {
      rootScopeTag = 'E';
      rootScopeValue = rootETag[1] || null;
      rootScopeRelay = rootETag[2] || null;
      rootScopePubkey = rootETag[3] || null;
    } else if (rootITag) {
      rootScopeTag = 'I';
      rootScopeValue = rootITag[1] || null;
      rootScopeRelay = rootITag[2] || null;
    }

    // Determine which parent scope tag is used
    let parentScopeTag: string | null = null;
    let parentScopeValue: string | null = null;
    let parentScopeRelay: string | null = null;
    let parentScopePubkey: string | null = null;

    if (parentATag) {
      parentScopeTag = 'a';
      parentScopeValue = parentATag[1] || null;
      parentScopeRelay = parentATag[2] || null;
    } else if (parentETag) {
      parentScopeTag = 'e';
      parentScopeValue = parentETag[1] || null;
      parentScopeRelay = parentETag[2] || null;
      parentScopePubkey = parentETag[3] || null;
    } else if (parentITag) {
      parentScopeTag = 'i';
      parentScopeValue = parentITag[1] || null;
      parentScopeRelay = parentITag[2] || null;
    }

    return {
      rootScopeTag,
      rootScopeValue,
      rootScopeRelay,
      rootScopePubkey,
      rootKind: rootKTag?.[1] || null,
      rootAuthor: rootPTag?.[1] || null,

      parentScopeTag,
      parentScopeValue,
      parentScopeRelay,
      parentScopePubkey,
      parentKind: parentKTag?.[1] || null,
      parentAuthor: parentPTag?.[1] || null,
    };
  }
}
