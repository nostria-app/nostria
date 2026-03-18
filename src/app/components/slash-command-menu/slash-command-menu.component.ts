import {
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

export interface SlashCommandOption {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Keywords for filtering (in addition to label) */
  keywords?: string[];
}

export interface SlashCommandConfig {
  /** Current cursor position in the text */
  cursorPosition: number;
  /** The search query (text after /) */
  query: string;
  /** Starting position of the / command in the text */
  commandStart: number;
}

/** All available slash command options */
export const SLASH_COMMAND_OPTIONS: SlashCommandOption[] = [
  { id: 'upload', label: 'Upload media', icon: 'upload', description: 'Upload an image or video', keywords: ['image', 'video', 'photo', 'file', 'attach'] },
  { id: 'library', label: 'Media library', icon: 'photo_library', description: 'Choose from your media library', keywords: ['image', 'video', 'photo', 'choose', 'browse'] },
  { id: 'emoji', label: 'Emoji', icon: 'sentiment_satisfied', description: 'Insert an emoji', keywords: ['smiley', 'face', 'emoticon'] },
  { id: 'gif', label: 'GIF', icon: 'gif_box', description: 'Search and insert a GIF', keywords: ['animation', 'animated'] },
  { id: 'mention', label: 'Mention', icon: 'alternate_email', description: 'Mention a user', keywords: ['user', 'person', 'tag', 'at'] },
  { id: 'reference', label: 'Reference', icon: 'bookmarks', description: 'Insert a nostr reference', keywords: ['note', 'event', 'article', 'link', 'bookmark'] },
  { id: 'dictate', label: 'Dictate', icon: 'mic', description: 'Dictate with voice', keywords: ['voice', 'speech', 'record', 'microphone'] },
];

@Component({
  selector: 'app-slash-command-menu',
  imports: [MatIconModule],
  template: `
    @if (isVisible() && filteredOptions().length > 0) {
      <div
        class="slash-command-menu"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        [style.maxHeight.px]="maxHeight()"
        tabindex="0"
        #menuContainer
      >
        <div class="slash-command-header">
          <mat-icon class="slash-icon">bolt</mat-icon>
          <span class="slash-title">Commands</span>
          @if (config()?.query; as q) {
            <span class="slash-query">/ {{ q }}</span>
          }
        </div>

        <div class="slash-command-list">
          @for (option of filteredOptions(); track option.id; let i = $index) {
            <div
              class="slash-command-item"
              [class.focused]="focusedIndex() === i"
              (click)="selectCommand(option)"
              (mouseenter)="setFocusedIndex(i)"
              tabindex="0"
              role="button"
              [attr.aria-selected]="focusedIndex() === i"
            >
              <mat-icon class="command-icon">{{ option.icon }}</mat-icon>
              <div class="command-details">
                <span class="command-label">{{ option.label }}</span>
                <span class="command-description">{{ option.description }}</span>
              </div>
            </div>
          }
        </div>

        <div class="slash-command-footer">
          <small class="slash-hint">
            ↑↓ navigate · Enter select · Esc close
          </small>
        </div>
      </div>
    }
  `,
  styleUrl: './slash-command-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlashCommandMenuComponent {
  config = input.required<SlashCommandConfig | null>();
  position = input<{ top: number; left: number }>({ top: 0, left: 0 });
  maxHeight = input<number>(360);

  commandSelected = output<SlashCommandOption>();
  dismissed = output<void>();

  menuContainer = viewChild<ElementRef<HTMLDivElement>>('menuContainer');

  focusedIndex = signal<number>(0);

  filteredOptions = computed(() => {
    const cfg = this.config();
    if (!cfg) return [];

    const query = cfg.query.toLowerCase();
    if (!query) return SLASH_COMMAND_OPTIONS;

    return SLASH_COMMAND_OPTIONS.filter(opt => {
      if (opt.label.toLowerCase().includes(query)) return true;
      if (opt.description.toLowerCase().includes(query)) return true;
      return opt.keywords?.some(kw => kw.includes(query)) ?? false;
    });
  });

  isVisible = computed(() => {
    const cfg = this.config();
    return cfg !== null && this.filteredOptions().length > 0;
  });

  constructor() {
    // Reset focused index when filtered options change
    effect(() => {
      this.filteredOptions();
      this.focusedIndex.set(0);
    });

    // Scroll to focused item
    effect(() => {
      const index = this.focusedIndex();
      if (this.isVisible()) {
        this.scrollToFocusedItem(index);
      }
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    const options = this.filteredOptions();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        this.focusedIndex.update(i => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        this.focusedIndex.update(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case 'Tab': {
        event.preventDefault();
        event.stopPropagation();
        const focused = options[this.focusedIndex()];
        if (focused) this.selectCommand(focused);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit();
        break;
    }
  }

  setFocusedIndex(index: number): void {
    this.focusedIndex.set(index);
  }

  selectCommand(option: SlashCommandOption): void {
    this.commandSelected.emit(option);
  }

  private scrollToFocusedItem(index: number): void {
    setTimeout(() => {
      const container = this.menuContainer()?.nativeElement;
      const items = container?.querySelectorAll('.slash-command-item');
      if (items?.[index]) {
        (items[index] as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }, 10);
  }
}
