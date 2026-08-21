import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';

export type MessageContextActionId =
  | 'reply'
  | 'create-thread'
  | 'copy-text'
  | 'copy-id'
  | 'copy-link'
  | 'copy-data'
  | 'mention'
  | 'pin'
  | 'unpin'
  | 'zap'
  | 'hide'
  | 'mute'
  | 'save-gif'
  | 'delete';

export interface MessageContextAction {
  id: MessageContextActionId;
  icon: string;
  label: string;
  destructive?: boolean;
}

export interface MessageContextSheetData {
  quickReactions: readonly string[];
  showReactions: boolean;
  sections: MessageContextAction[][];
}

export type MessageContextSheetResult =
  | { kind: 'reaction'; emoji: string }
  | { kind: 'more-reactions' }
  | { kind: 'action'; id: MessageContextActionId };

export function messageContextAction(id: MessageContextActionId): MessageContextAction {
  switch (id) {
    case 'reply':
      return { id, icon: 'reply', label: $localize`:@@event.actions.reply:Reply` };
    case 'create-thread':
      return {
        id,
        icon: 'forum',
        label: $localize`:@@chat.message.create-thread:Create Thread`,
      };
    case 'copy-text':
      return {
        id,
        icon: 'content_copy',
        label: $localize`:@@chat.message.copy-text:Copy Text`,
      };
    case 'copy-id':
      return {
        id,
        icon: 'tag',
        label: $localize`:@@chat.message.copy-id:Copy Message ID`,
      };
    case 'copy-link':
      return {
        id,
        icon: 'link',
        label: $localize`:@@chat.message.copy-link:Copy Message Link`,
      };
    case 'copy-data':
      return {
        id,
        icon: 'data_object',
        label: $localize`:@@chat.message.copy-data:Copy Data`,
      };
    case 'mention':
      return {
        id,
        icon: 'alternate_email',
        label: $localize`:@@chat.message.mention:Mention`,
      };
    case 'pin':
      return { id, icon: 'push_pin', label: $localize`:@@chat.message.pin:Pin Message` };
    case 'unpin':
      return { id, icon: 'push_pin', label: $localize`:@@chat.message.unpin:Unpin Message` };
    case 'zap':
      return { id, icon: 'bolt', label: $localize`:@@event.actions.zap:Zap` };
    case 'hide':
      return {
        id,
        icon: 'visibility_off',
        label: $localize`:@@chat.message.hide:Hide Message`,
      };
    case 'mute':
      return { id, icon: 'block', label: $localize`:@@chat.message.mute:Mute User` };
    case 'save-gif':
      return {
        id,
        icon: 'gif_box',
        label: $localize`:@@chat.message.save-gif:Save to Gifs Set`,
      };
    case 'delete':
      return {
        id,
        icon: 'delete',
        label: $localize`:@@chat.message.delete:Delete Message`,
        destructive: true,
      };
  }
}

@Component({
  selector: 'app-message-context-sheet',
  imports: [MatIconModule],
  templateUrl: './message-context-sheet.component.html',
  styleUrl: './message-context-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageContextSheetComponent {
  private readonly sheetRef = inject(MatBottomSheetRef<MessageContextSheetComponent, MessageContextSheetResult>);
  readonly data = inject<MessageContextSheetData>(MAT_BOTTOM_SHEET_DATA);

  pickReaction(emoji: string): void {
    this.sheetRef.dismiss({ kind: 'reaction', emoji });
  }

  moreReactions(): void {
    this.sheetRef.dismiss({ kind: 'more-reactions' });
  }

  pickAction(action: MessageContextAction): void {
    this.sheetRef.dismiss({ kind: 'action', id: action.id });
  }

  isDestructiveSection(section: MessageContextAction[]): boolean {
    return section.length > 0 && section.every(action => action.destructive);
  }
}
