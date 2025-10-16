import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ListType, ListData, ListItem } from '../lists.component';

interface EditorData {
  listType: ListType;
  listData?: ListData;
  mode: 'create' | 'edit';
}

@Component({
  selector: 'app-list-editor-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  templateUrl: './list-editor-dialog.component.html',
  styleUrl: './list-editor-dialog.component.scss',
})
export class ListEditorDialogComponent implements OnInit {
  dialogRef = inject(MatDialogRef<ListEditorDialogComponent>);
  data = inject<EditorData>(MAT_DIALOG_DATA);

  listType: ListType;
  mode: 'create' | 'edit';

  // Form fields
  title = signal('');
  description = signal('');
  image = signal('');
  identifier = signal('');

  // Items
  publicItems = signal<ListItem[]>([]);
  privateItems = signal<ListItem[]>([]);

  // New item inputs
  newItemTag = signal('');
  newItemValue = signal('');
  newItemRelay = signal('');
  newItemIsPrivate = signal(false);

  // Computed
  isValid = computed(() => {
    // For sets, identifier is required
    if (!this.listType.isReplaceable && !this.identifier().trim()) {
      return false;
    }

    // At least one item is recommended (but not required)
    return true;
  });

  totalItems = computed(() => this.publicItems().length + this.privateItems().length);

  // In edit mode, identifier cannot be changed (would create duplicate)
  identifierDisabled = computed(() => this.mode === 'edit' && !this.listType.isReplaceable);

  constructor() {
    this.listType = this.data.listType;
    this.mode = this.data.mode;
  }

  ngOnInit() {
    if (this.mode === 'edit' && this.data.listData) {
      this.loadExistingData(this.data.listData);
    } else if (!this.listType.isReplaceable) {
      // Generate a default identifier for new sets
      this.identifier.set(this.generateIdentifier());
    }

    // Set default tag for new items
    if (this.listType.expectedTags.length > 0) {
      this.newItemTag.set(this.listType.expectedTags[0]);
    }
  }

  /**
   * Load existing list data for editing
   */
  private loadExistingData(listData: ListData) {
    this.title.set(listData.title || '');
    this.description.set(listData.description || '');
    this.image.set(listData.image || '');
    this.identifier.set(listData.identifier || '');
    this.publicItems.set([...listData.publicItems]);
    this.privateItems.set([...listData.privateItems]);
  }

  /**
   * Generate a random identifier for sets
   */
  private generateIdentifier(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Add new item to the list
   */
  addItem() {
    const tag = this.newItemTag().trim();
    const value = this.newItemValue().trim();

    if (!tag || !value) return;

    const item: ListItem = {
      tag,
      value,
      relay: this.newItemRelay().trim() || undefined,
    };

    if (this.newItemIsPrivate()) {
      this.privateItems.update(items => [...items, item]);
    } else {
      this.publicItems.update(items => [...items, item]);
    }

    // Reset new item inputs
    this.newItemValue.set('');
    this.newItemRelay.set('');
  }

  /**
   * Remove an item from public list
   */
  removePublicItem(index: number) {
    this.publicItems.update(items => items.filter((_, i) => i !== index));
  }

  /**
   * Remove an item from private list
   */
  removePrivateItem(index: number) {
    this.privateItems.update(items => items.filter((_, i) => i !== index));
  }

  /**
   * Move item from public to private
   */
  moveToPrivate(index: number) {
    const item = this.publicItems()[index];
    this.removePublicItem(index);
    this.privateItems.update(items => [...items, item]);
  }

  /**
   * Move item from private to public
   */
  moveToPublic(index: number) {
    const item = this.privateItems()[index];
    this.removePrivateItem(index);
    this.publicItems.update(items => [...items, item]);
  }

  /**
   * Get display text for an item
   */
  getItemDisplay(item: ListItem): string {
    let display = `[${item.tag}] ${item.value}`;
    if (item.relay) {
      display += ` (${item.relay})`;
    }
    return display;
  }

  /**
   * Get icon for tag type
   */
  getTagIcon(tag: string): string {
    switch (tag) {
      case 'p':
        return 'person';
      case 'e':
        return 'description';
      case 'a':
        return 'link';
      case 't':
        return 'tag';
      case 'r':
        return 'public';
      case 'relay':
        return 'router';
      case 'word':
        return 'text_fields';
      case 'emoji':
        return 'emoji_emotions';
      case 'group':
        return 'group_work';
      default:
        return 'label';
    }
  }

  /**
   * Save the list
   */
  save() {
    if (!this.isValid()) return;

    this.dialogRef.close({
      listType: this.listType,
      title: this.title().trim() || undefined,
      description: this.description().trim() || undefined,
      image: this.image().trim() || undefined,
      identifier: this.identifier().trim() || undefined,
      publicItems: this.publicItems(),
      privateItems: this.privateItems(),
    });
  }

  /**
   * Cancel and close dialog
   */
  cancel() {
    this.dialogRef.close();
  }

  /**
   * Download list as Nostr event JSON file for backup
   * Exports the raw event if editing, or creates a template if creating new
   */
  downloadList() {
    let exportData: Record<string, unknown>;

    if (this.mode === 'edit' && this.data.listData?.event) {
      // Export the original Nostr event
      exportData = { ...this.data.listData.event } as Record<string, unknown>;
    } else {
      // Export as a template (without event metadata - will be created on import)
      exportData = {
        kind: this.listType.kind,
        tags: this.buildTags(),
        content: this.buildContent(),
        // Note: No id, sig, pubkey, created_at - these will be generated when imported
        _isTemplate: true,
        _metadata: {
          listTypeName: this.listType.name,
          exportedAt: new Date().toISOString(),
        },
      };
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `nostr-${this.listType.kind}-${this.identifier() || 'list'
      }-${Date.now()}.json`;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Build tags array for the list (used for export and save)
   */
  private buildTags(): string[][] {
    const tags: string[][] = [];

    // Add identifier for sets
    if (!this.listType.isReplaceable && this.identifier()) {
      tags.push(['d', this.identifier()]);
    }

    // Add metadata tags
    if (this.title()) {
      tags.push(['title', this.title()]);
    }
    if (this.description()) {
      tags.push(['description', this.description()]);
    }
    if (this.image()) {
      tags.push(['image', this.image()]);
    }

    // Add public items
    for (const item of this.publicItems()) {
      const tag: string[] = [item.tag, item.value];
      if (item.relay) tag.push(item.relay);
      if (item.marker) tag.push(item.marker);
      if (item.metadata) tag.push(item.metadata);
      tags.push(tag);
    }

    return tags;
  }

  /**
   * Build encrypted content for private items (used for export and save)
   */
  private buildContent(): string {
    // Content would contain encrypted private items
    // For template export, we'll include a note about private items
    if (this.privateItems().length > 0) {
      return JSON.stringify({
        _note: 'Private items need to be encrypted when publishing',
        _privateItemCount: this.privateItems().length,
        _privateItems: this.privateItems(),
      });
    }
    return '';
  }

  /**
   * Import list from Nostr event JSON file
   */
  async importList(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;

      // Validate kind matches
      if (typeof data['kind'] !== 'number' || data['kind'] !== this.listType.kind) {
        alert(
          `Invalid list type. Expected ${this.listType.name} (kind ${this.listType.kind})`
        );
        return;
      }

      // Parse tags array
      const tags = data['tags'] as string[][];
      if (!Array.isArray(tags)) {
        alert('Invalid event format: missing or invalid tags array');
        return;
      }

      // Clear existing items
      this.publicItems.set([]);
      this.privateItems.set([]);

      // Parse tags
      for (const tag of tags) {
        if (!Array.isArray(tag) || tag.length < 2) continue;

        const tagName = tag[0];
        const tagValue = tag[1];

        // Handle metadata tags
        if (tagName === 'd' && this.mode === 'create') {
          this.identifier.set(tagValue);
        } else if (tagName === 'title') {
          this.title.set(tagValue);
        } else if (tagName === 'description') {
          this.description.set(tagValue);
        } else if (tagName === 'image') {
          this.image.set(tagValue);
        } else {
          // Handle item tags
          const item: ListItem = {
            tag: tagName,
            value: tagValue,
            relay: tag[2],
            marker: tag[3],
            metadata: tag[4],
          };
          this.publicItems.update((items) => [...items, item]);
        }
      }

      // Parse content for private items (if any)
      const content = data['content'] as string;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          if (parsed._privateItems && Array.isArray(parsed._privateItems)) {
            this.privateItems.set(parsed._privateItems);
          }
        } catch {
          // Content is not JSON or doesn't contain private items template
          // This is fine - it might be encrypted or just a regular string
        }
      }

      // Reset file input
      input.value = '';
    } catch (error) {
      console.error('Failed to import list:', error);
      alert('Failed to import list. Please check the file format.');
    }
  }

  /**
   * Trigger file input for import
   */
  triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = (e) => this.importList(e);
    input.click();
  }
}
