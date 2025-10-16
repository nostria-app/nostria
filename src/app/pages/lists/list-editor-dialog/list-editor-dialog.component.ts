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
      case 'word':
        return 'text_fields';
      case 'emoji':
        return 'emoji_emotions';
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
}
