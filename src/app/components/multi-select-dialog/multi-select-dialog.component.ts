import { Component, input, output, signal, computed, ChangeDetectionStrategy, effect, DestroyRef, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';

export interface SelectableItem {
  id: string;
  title: string;
  subtitle?: string;
  count?: number;
  selected: boolean;
}

@Component({
  selector: 'app-multi-select-dialog',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    CustomDialogComponent,
  ],
  templateUrl: './multi-select-dialog.component.html',
  styleUrls: ['./multi-select-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiSelectDialogComponent {
  // Inputs
  title = input<string>('Select Items');
  items = input<SelectableItem[]>([]);
  searchPlaceholder = input<string>('Search...');
  emptyMessage = input<string>('No items available');

  // Outputs
  closed = output<SelectableItem[] | null>();

  // State
  searchControl = new FormControl('');
  searchValue = signal('');
  selectedItems = signal<SelectableItem[]>([]);
  private destroyRef = inject(DestroyRef);

  constructor() {
    // Track search input with proper cleanup
    this.searchControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        this.searchValue.set((value || '').toLowerCase());
      });

    // Initialize selected items when input items change
    effect(() => {
      const items = this.items();
      this.selectedItems.set(items.filter(item => item.selected));
    });
  }

  // Filtered items based on search
  filteredItems = computed(() => {
    const search = this.searchValue();
    const items = this.items();

    if (!search) {
      return items;
    }

    return items.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(search);
      const subtitleMatch = item.subtitle?.toLowerCase().includes(search) ?? false;
      return titleMatch || subtitleMatch;
    });
  });

  selectedCount = computed(() => {
    return this.items().filter(item => item.selected).length;
  });

  toggleItem(item: SelectableItem): void {
    // Update selection without mutating input
    const items = this.items();
    const itemIndex = items.indexOf(item);
    if (itemIndex !== -1) {
      items[itemIndex].selected = !items[itemIndex].selected;
    }
    
    // Update the selected items signal
    const selected = items.filter(i => i.selected);
    this.selectedItems.set(selected);
  }

  selectAll(): void {
    const filtered = this.filteredItems();
    const items = this.items();
    
    filtered.forEach(filteredItem => {
      const item = items.find(i => i.id === filteredItem.id);
      if (item) {
        item.selected = true;
      }
    });
    
    // Update the selected items signal
    const selected = items.filter(i => i.selected);
    this.selectedItems.set(selected);
  }

  clearAll(): void {
    const filtered = this.filteredItems();
    const items = this.items();
    
    filtered.forEach(filteredItem => {
      const item = items.find(i => i.id === filteredItem.id);
      if (item) {
        item.selected = false;
      }
    });
    
    // Update the selected items signal
    const selected = items.filter(i => i.selected);
    this.selectedItems.set(selected);
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  onConfirm(): void {
    const selected = this.items().filter(item => item.selected);
    this.closed.emit(selected);
  }
}
