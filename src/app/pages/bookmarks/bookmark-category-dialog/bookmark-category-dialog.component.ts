import { Component, Inject, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LoggerService } from '../../../services/logger.service';

interface BookmarkCategory {
  id: string;
  name: string;
  color: string;
}

interface DialogData {
  categories: BookmarkCategory[];
}

@Component({
  selector: 'app-bookmark-category-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './bookmark-category-dialog.component.html',
  styleUrls: ['./bookmark-category-dialog.component.scss'],
})
export class BookmarkCategoryDialogComponent {
  private logger = inject(LoggerService);

  categories = signal<BookmarkCategory[]>([]);
  availableColors = [
    '#f44336', // Red
    '#e91e63', // Pink
    '#9c27b0', // Purple
    '#673ab7', // Deep Purple
    '#3f51b5', // Indigo
    '#2196f3', // Blue
    '#03a9f4', // Light Blue
    '#00bcd4', // Cyan
    '#009688', // Teal
    '#4caf50', // Green
    '#8bc34a', // Light Green
    '#cddc39', // Lime
    '#ffeb3b', // Yellow
    '#ffc107', // Amber
    '#ff9800', // Orange
    '#ff5722', // Deep Orange
    '#795548', // Brown
    '#607d8b', // Blue Grey
  ];

  newCategory = {
    name: '',
    color: this.availableColors[0],
  };

  editingCategory: { index: number; name: string; color: string } | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private dialogRef: MatDialogRef<BookmarkCategoryDialogComponent>
  ) {
    // Skip the "All" category which is always fixed
    const categoriesWithoutAll = data.categories.filter(cat => cat.id !== 'all');
    this.categories.set(categoriesWithoutAll);
    this.logger.debug('BookmarkCategoryDialog initialized with categories:', this.categories());
  }

  addCategory(): void {
    if (!this.newCategory.name.trim()) {
      return;
    }

    // Create a simplified ID from the name
    const id = this.newCategory.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 20);

    // Check if ID already exists
    if (this.categories().some(cat => cat.id === id)) {
      this.logger.debug('Category with this name already exists');
      return;
    }

    const newCategory: BookmarkCategory = {
      id,
      name: this.newCategory.name.trim(),
      color: this.newCategory.color,
    };

    this.categories.update(categories => [...categories, newCategory]);
    this.newCategory.name = '';
    this.newCategory.color = this.availableColors[0];
    this.logger.debug('Category added:', newCategory);
  }

  startEditing(index: number): void {
    const category = this.categories()[index];
    this.editingCategory = {
      index,
      name: category.name,
      color: category.color,
    };
    this.logger.debug('Editing category:', category);
  }

  cancelEditing(): void {
    this.editingCategory = null;
  }

  saveEditing(): void {
    if (!this.editingCategory || !this.editingCategory.name.trim()) {
      return;
    }

    this.categories.update(categories => {
      const updated = [...categories];
      const category = updated[this.editingCategory!.index];

      updated[this.editingCategory!.index] = {
        ...category,
        name: this.editingCategory!.name.trim(),
        color: this.editingCategory!.color,
      };

      return updated;
    });

    this.logger.debug('Category updated:', this.categories()[this.editingCategory.index]);
    this.editingCategory = null;
  }

  deleteCategory(index: number): void {
    this.categories.update(categories => {
      const updated = [...categories];
      updated.splice(index, 1);
      return updated;
    });
    this.logger.debug('Category deleted at index:', index);
  }

  save(): void {
    // Add back the "All" category which is always fixed
    const allCategories = [{ id: 'all', name: 'All', color: '#9c27b0' }, ...this.categories()];

    this.dialogRef.close(allCategories);
    this.logger.debug('Categories saved:', allCategories);
  }
}
