import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { LocalSettingsService, MenuItemConfig } from '../../../services/local-settings.service';

/**
 * Available menu item definition with all metadata
 */
interface AvailableMenuItem {
  id: string;
  label: string;
  icon: string;
  authenticated: boolean;
}

/**
 * All available menu items that can be added to the navigation.
 * This list includes all possible menu options from the Home component.
 */
const ALL_MENU_ITEMS: AvailableMenuItem[] = [
  { id: '/', label: $localize`:@@app.nav.home:Home`, icon: 'home', authenticated: true },
  { id: '/f', label: $localize`:@@app.nav.feeds:Feeds`, icon: 'stacks', authenticated: false },
  { id: 'summary', label: $localize`:@@app.nav.summary:Summary`, icon: 'dashboard', authenticated: true },
  { id: 'messages', label: $localize`:@@app.nav.messages:Messages`, icon: 'mail', authenticated: true },
  { id: 'articles', label: $localize`:@@app.nav.articles:Articles`, icon: 'article', authenticated: false },
  { id: 'discover', label: $localize`:@@app.nav.discover:Discover`, icon: 'explore', authenticated: true },
  { id: 'search', label: $localize`:@@app.nav.search:Search`, icon: 'manage_search', authenticated: false },
  { id: 'people', label: $localize`:@@app.nav.people:People`, icon: 'people', authenticated: true },
  { id: 'collections', label: $localize`:@@app.nav.collections:Collections`, icon: 'bookmarks', authenticated: true },
  { id: 'clips', label: $localize`:@@app.nav.clips:Clips`, icon: 'smart_display', authenticated: false },
  { id: 'music', label: $localize`:@@app.nav.music:Music`, icon: 'music_note', authenticated: false },
  { id: 'streams', label: $localize`:@@app.nav.streams:Streams`, icon: 'live_tv', authenticated: false },
  { id: 'notifications', label: $localize`:@@menu.notifications:Notifications`, icon: 'notifications', authenticated: true },
  { id: 'collections/media', label: $localize`:@@menu.media:Media`, icon: 'photo_library', authenticated: true },
  // Note: 'lists' is intentionally omitted - it's a power-user feature accessible only via direct URL /lists
  { id: 'polls', label: $localize`:@@menu.polls:Polls`, icon: 'poll', authenticated: false },
  { id: 'playlists', label: $localize`:@@menu.playlists:Playlists`, icon: 'playlist_play', authenticated: false },
  { id: 'queue', label: $localize`:@@menu.queue:Queue`, icon: 'queue_music', authenticated: false },
  { id: 'meetings', label: $localize`:@@menu.meetings:Live Meetings`, icon: 'adaptive_audio_mic', authenticated: false },
  { id: 'memos', label: $localize`:@@menu.memos:Memos`, icon: 'sticky_note_2', authenticated: true },
  { id: 'calendar', label: $localize`:@@menu.calendar:Calendar`, icon: 'calendar_month', authenticated: true },
  { id: 'analytics', label: $localize`:@@menu.analytics:Analytics`, icon: 'bar_chart', authenticated: true },
  { id: 'newsletter', label: $localize`:@@menu.newsletter:Newsletter`, icon: 'campaign', authenticated: true },
  { id: 'premium', label: $localize`:@@app.nav.premium:Premium`, icon: 'diamond', authenticated: true },
  { id: 'settings', label: $localize`:@@menu.settings:Settings`, icon: 'settings', authenticated: false },
  { id: 'wallet', label: $localize`:@@menu.wallet:Wallet`, icon: 'account_balance_wallet', authenticated: true },
];

/**
 * Default menu items (matches the default navItems in app.ts)
 */
const DEFAULT_MENU_IDS = [
  '/',
  '/f',
  'articles',
  'summary',
  'messages',
  'people',
  'collections',
  'clips',
  'music',
  'streams',
];

@Component({
  selector: 'app-setting-menu-editor',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatDividerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="menu-editor">
      <div class="editor-header">
        <h3 i18n="@@settings.menu.customize">Customize Menu</h3>
        <p class="description" i18n="@@settings.menu.description">
          Drag items to reorder. Move items between lists to show or hide them.
        </p>
      </div>

      <div class="lists-container">
        <!-- Active Menu Items -->
        <div class="list-section">
          <h4 i18n="@@settings.menu.visible">Visible Items</h4>
          <div
            cdkDropList
            id="active-menu-list"
            #activeList="cdkDropList"
            [cdkDropListData]="activeItems()"
            [cdkDropListConnectedTo]="[availableList]"
            class="menu-list active-list"
            (cdkDropListDropped)="drop($event, 'active')">
@for (item of activeItems(); track item.id) {
              <div class="menu-item" cdkDrag>
                <div class="drag-handle" cdkDragHandle>
                  <mat-icon>drag_indicator</mat-icon>
                </div>
                <mat-icon class="item-icon">{{ item.icon }}</mat-icon>
                <span class="item-label">{{ item.label }}</span>
                <button mat-icon-button class="remove-button" (click)="removeItem(item.id)" 
                  i18n-aria-label="@@settings.menu.remove" aria-label="Remove from menu">
                  <mat-icon>remove_circle_outline</mat-icon>
                </button>
              </div>
            }
            @if (activeItems().length === 0) {
              <div class="empty-state" i18n="@@settings.menu.empty-active">
                No items in menu. Add items from below.
              </div>
            }
          </div>
        </div>

        <mat-divider [vertical]="true"></mat-divider>

        <!-- Available Menu Items -->
        <div class="list-section">
          <h4 i18n="@@settings.menu.hidden">Hidden Items</h4>
          <div
            cdkDropList
            id="hidden-menu-list"
            #availableList="cdkDropList"
            [cdkDropListData]="hiddenItems()"
            [cdkDropListConnectedTo]="[activeList]"
            class="menu-list available-list"
            (cdkDropListDropped)="drop($event, 'hidden')">
@for (item of hiddenItems(); track item.id) {
              <div class="menu-item" cdkDrag>
                <div class="drag-handle" cdkDragHandle>
                  <mat-icon>drag_indicator</mat-icon>
                </div>
                <mat-icon class="item-icon">{{ item.icon }}</mat-icon>
                <span class="item-label">{{ item.label }}</span>
                <button mat-icon-button class="add-button" (click)="addItem(item.id)"
                  i18n-aria-label="@@settings.menu.add" aria-label="Add to menu">
                  <mat-icon>add_circle_outline</mat-icon>
                </button>
              </div>
            }
            @if (hiddenItems().length === 0) {
              <div class="empty-state" i18n="@@settings.menu.empty-hidden">
                All items are visible in menu.
              </div>
            }
          </div>
        </div>
      </div>

      <div class="actions">
        <button mat-stroked-button (click)="resetToDefault()" i18n="@@settings.menu.reset">
          Reset to Default
        </button>
      </div>
    </div>
  `,
  styles: [`
    .menu-editor {
      padding: 16px 0;
    }

    .editor-header {
      margin-bottom: 16px;

      h3 {
        margin: 0 0 8px 0;
      }

      .description {
        color: var(--mat-sys-on-surface-variant);
        margin: 0;
        font-size: 0.875rem;
      }
    }

    .lists-container {
      display: flex;
      gap: 16px;
      min-height: 300px;

      @media (max-width: 600px) {
        flex-direction: column;
      }
    }

    .list-section {
      flex: 1;
      min-width: 0;

      h4 {
        margin: 0 0 8px 0;
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    }

    mat-divider[vertical] {
      height: auto;

      @media (max-width: 600px) {
        display: none;
      }
    }

    .menu-list {
      min-height: 200px;
      background: var(--mat-sys-surface-container-low);
      border-radius: 12px;
      padding: 8px;
      border: 2px dashed transparent;
      transition: border-color 0.2s, background-color 0.2s;

      &.cdk-drop-list-dragging {
        border-color: var(--mat-sys-primary);
        background: var(--mat-sys-surface-container);
      }
    }

    .menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 8px;
      margin-bottom: 4px;
      cursor: default;
      touch-action: pan-y;
      transition: background-color 0.2s, box-shadow 0.2s;

      &:hover {
        background: var(--mat-sys-surface-container-highest);
      }

      &:last-child {
        margin-bottom: 0;
      }

      &.cdk-drag-preview {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        background: var(--mat-sys-surface-container-highest);
      }

      &.cdk-drag-placeholder {
        opacity: 0.4;
      }

      &.cdk-drag-animating {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }
    }

    .drag-handle {
      color: var(--mat-sys-on-surface-variant);
      cursor: grab;
      touch-action: none;
      display: flex;
      align-items: center;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .item-icon {
      color: var(--mat-sys-primary);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

.item-label {
      flex: 1;
      font-size: 0.9rem;
    }

    .remove-button, .add-button {
      opacity: 0.6;
      transition: opacity 0.2s;

      &:hover {
        opacity: 1;
      }
    }

    .remove-button mat-icon {
      color: var(--mat-sys-error);
    }

    .add-button mat-icon {
      color: var(--mat-sys-primary);
    }

    .empty-state {
      padding: 32px 16px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    .actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
    }

    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 8px;
      box-shadow: 0 5px 5px -3px rgba(0, 0, 0, 0.2),
        0 8px 10px 1px rgba(0, 0, 0, 0.14),
        0 3px 14px 2px rgba(0, 0, 0, 0.12);
    }
  `],
})
export class SettingMenuEditorComponent {
  private readonly localSettings = inject(LocalSettingsService);

  /**
   * Internal state for active (visible) items
   */
  private readonly _activeItems = signal<AvailableMenuItem[]>([]);

  /**
   * Internal state for hidden items
   */
  private readonly _hiddenItems = signal<AvailableMenuItem[]>([]);

  /**
   * Active (visible) menu items in display order
   */
  readonly activeItems = this._activeItems.asReadonly();

  /**
   * Hidden menu items available to add
   */
  readonly hiddenItems = this._hiddenItems.asReadonly();

  constructor() {
    this.loadCurrentConfig();
  }

  /**
   * Load current menu configuration from settings
   */
  private loadCurrentConfig(): void {
    const savedConfig = this.localSettings.menuItems();

    if (savedConfig.length === 0) {
      // Use default configuration
      this.initializeFromDefaults();
    } else {
      // Restore from saved config
      this.restoreFromConfig(savedConfig);
    }
  }

  /**
   * Initialize menu items from defaults
   */
  private initializeFromDefaults(): void {
    const active: AvailableMenuItem[] = [];
    const hidden: AvailableMenuItem[] = [];

    for (const item of ALL_MENU_ITEMS) {
      if (DEFAULT_MENU_IDS.includes(item.id)) {
        active.push(item);
      } else {
        hidden.push(item);
      }
    }

    // Sort active items by default order
    active.sort((a, b) => {
      return DEFAULT_MENU_IDS.indexOf(a.id) - DEFAULT_MENU_IDS.indexOf(b.id);
    });

    this._activeItems.set(active);
    this._hiddenItems.set(hidden);
  }

  /**
   * Restore menu items from saved configuration
   */
  private restoreFromConfig(config: MenuItemConfig[]): void {
    const active: AvailableMenuItem[] = [];
    const hidden: AvailableMenuItem[] = [];
    const processedIds = new Set<string>();

    // Create a map of all menu items for quick lookup
    const itemMap = new Map(ALL_MENU_ITEMS.map(item => [item.id, item]));

    // First add items in saved order, deduplicating any duplicates
    for (const savedItem of config) {
      // Skip duplicate entries in the saved config
      if (processedIds.has(savedItem.id)) {
        continue;
      }

      const menuItem = itemMap.get(savedItem.id);
      if (menuItem) {
        if (savedItem.visible) {
          active.push(menuItem);
        } else {
          hidden.push(menuItem);
        }
        processedIds.add(savedItem.id);
        itemMap.delete(savedItem.id);
      }
    }

    // Add any new items that weren't in the saved config (for forward compatibility)
    for (const [, menuItem] of itemMap) {
      hidden.push(menuItem);
    }

    this._activeItems.set(active);
    this._hiddenItems.set(hidden);
  }

  /**
   * Handle drag and drop between lists
   * @param event The CDK drag drop event
   * @param targetList Which list the item was dropped on: 'active' or 'hidden'
   */
  drop(event: CdkDragDrop<AvailableMenuItem[]>, targetList: 'active' | 'hidden'): void {
    // Get current state - use fresh copies
    const activeItems = [...this._activeItems()];
    const hiddenItems = [...this._hiddenItems()];

    // Determine source list based on which list the item came from
    const sourceList = event.previousContainer === event.container
      ? targetList  // Same container means source equals target
      : (targetList === 'active' ? 'hidden' : 'active');  // Different container means opposite

    if (event.previousContainer === event.container) {
      // Reorder within the same list
      if (targetList === 'active') {
        moveItemInArray(activeItems, event.previousIndex, event.currentIndex);
        this._activeItems.set(activeItems);
      } else {
        moveItemInArray(hiddenItems, event.previousIndex, event.currentIndex);
        this._hiddenItems.set(hiddenItems);
      }
    } else {
      // Transfer between lists
      if (sourceList === 'active') {
        // Moving from active to hidden
        const [movedItem] = activeItems.splice(event.previousIndex, 1);
        hiddenItems.splice(event.currentIndex, 0, movedItem);
      } else {
        // Moving from hidden to active
        const [movedItem] = hiddenItems.splice(event.previousIndex, 1);
        activeItems.splice(event.currentIndex, 0, movedItem);
      }
      this._activeItems.set(activeItems);
      this._hiddenItems.set(hiddenItems);
    }

    this.saveConfig();
  }

  /**
   * Add an item to the active list
   */
  addItem(id: string): void {
    const hidden = this._hiddenItems();
    const active = this._activeItems();
    const index = hidden.findIndex(item => item.id === id);

    if (index !== -1) {
      const item = hidden[index];
      this._hiddenItems.set(hidden.filter((_, i) => i !== index));
      this._activeItems.set([...active, item]);
      this.saveConfig();
    }
  }

  /**
   * Remove an item from the active list
   */
  removeItem(id: string): void {
    const active = this._activeItems();
    const hidden = this._hiddenItems();
    const index = active.findIndex(item => item.id === id);

    if (index !== -1) {
      const item = active[index];
      this._activeItems.set(active.filter((_, i) => i !== index));
      this._hiddenItems.set([...hidden, item]);
      this.saveConfig();
    }
  }

  /**
   * Reset menu to default configuration
   */
  resetToDefault(): void {
    this.localSettings.resetMenuItems();
    this.initializeFromDefaults();
  }

  /**
   * Save current configuration to settings
   */
  private saveConfig(): void {
    const config: MenuItemConfig[] = [
      ...this._activeItems().map(item => ({ id: item.id, visible: true })),
      ...this._hiddenItems().map(item => ({ id: item.id, visible: false })),
    ];
    this.localSettings.setMenuItems(config);
  }
}
