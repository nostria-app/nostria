/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { BookmarkCategoryDialogComponent } from './bookmark-category-dialog.component';

function createComponent(categories = [
    { id: 'all', name: 'All', color: '#9c27b0' },
    { id: 'tech', name: 'Tech', color: '#2196f3' },
    { id: 'music', name: 'Music', color: '#4caf50' },
]): BookmarkCategoryDialogComponent {
    const component = Object.create(BookmarkCategoryDialogComponent.prototype) as BookmarkCategoryDialogComponent;

    (component as any).logger = {
        debug: vi.fn(),
    };

    (component as any).data = { categories };

    (component as any).dialogRef = {
        close: vi.fn(),
    };

    // Initialize signals — mirrors what inject-time field initializers do
    (component as any).categories = signal(categories.filter((cat: any) => cat.id !== 'all'));

    (component as any).availableColors = [
        '#f44336', '#e91e63', '#9c27b0', '#673ab7',
        '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
        '#009688', '#4caf50', '#8bc34a', '#cddc39',
        '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
        '#795548', '#607d8b',
    ];

    (component as any).newCategory = {
        name: '',
        color: (component as any).availableColors[0],
    };

    (component as any).editingCategory = null;

    return component;
}

describe('BookmarkCategoryDialogComponent', () => {
    describe('initialization', () => {
        it('should filter out the "all" category from the provided data', () => {
            const component = createComponent();
            expect(component.categories().length).toBe(2);
            expect(component.categories().some(c => c.id === 'all')).toBe(false);
        });

        it('should keep non-all categories intact', () => {
            const component = createComponent();
            expect(component.categories()[0]).toEqual({ id: 'tech', name: 'Tech', color: '#2196f3' });
            expect(component.categories()[1]).toEqual({ id: 'music', name: 'Music', color: '#4caf50' });
        });

        it('should handle empty categories (only "all")', () => {
            const component = createComponent([{ id: 'all', name: 'All', color: '#9c27b0' }]);
            expect(component.categories().length).toBe(0);
        });
    });

    describe('addCategory', () => {
        it('should add a new category with a generated id', () => {
            const component = createComponent();
            component.newCategory.name = 'News';
            component.newCategory.color = '#ff9800';

            component.addCategory();

            expect(component.categories().length).toBe(3);
            expect(component.categories()[2]).toEqual({
                id: 'news',
                name: 'News',
                color: '#ff9800',
            });
        });

        it('should reset newCategory after adding', () => {
            const component = createComponent();
            component.newCategory.name = 'News';
            component.newCategory.color = '#ff9800';

            component.addCategory();

            expect(component.newCategory.name).toBe('');
            expect(component.newCategory.color).toBe(component.availableColors[0]);
        });

        it('should not add a category with an empty name', () => {
            const component = createComponent();
            component.newCategory.name = '   ';

            component.addCategory();

            expect(component.categories().length).toBe(2);
        });

        it('should not add a category with a duplicate id', () => {
            const component = createComponent();
            component.newCategory.name = 'Tech';

            component.addCategory();

            expect(component.categories().length).toBe(2);
        });

        it('should generate id by lowercasing, replacing spaces with dashes, and stripping special chars', () => {
            const component = createComponent();
            component.newCategory.name = 'My Cool Category!';
            component.newCategory.color = '#f44336';

            component.addCategory();

            const added = component.categories()[2];
            expect(added.id).toBe('my-cool-category');
        });

        it('should truncate generated id to 20 characters', () => {
            const component = createComponent();
            component.newCategory.name = 'This Is A Very Long Category Name';
            component.newCategory.color = '#f44336';

            component.addCategory();

            const added = component.categories()[2];
            expect(added.id.length).toBeLessThanOrEqual(20);
        });
    });

    describe('startEditing', () => {
        it('should set editingCategory with the correct index and values', () => {
            const component = createComponent();

            component.startEditing(0);

            expect(component.editingCategory).toEqual({
                index: 0,
                name: 'Tech',
                color: '#2196f3',
            });
        });
    });

    describe('cancelEditing', () => {
        it('should set editingCategory to null', () => {
            const component = createComponent();
            component.startEditing(0);

            component.cancelEditing();

            expect(component.editingCategory).toBeNull();
        });
    });

    describe('saveEditing', () => {
        it('should update the category at the editing index', () => {
            const component = createComponent();
            component.startEditing(0);
            component.editingCategory!.name = 'Technology';
            component.editingCategory!.color = '#673ab7';

            component.saveEditing();

            expect(component.categories()[0]).toEqual({
                id: 'tech',
                name: 'Technology',
                color: '#673ab7',
            });
            expect(component.editingCategory).toBeNull();
        });

        it('should not save when editingCategory is null', () => {
            const component = createComponent();
            const originalCategories = [...component.categories()];

            component.saveEditing();

            expect(component.categories()).toEqual(originalCategories);
        });

        it('should not save when editing name is empty', () => {
            const component = createComponent();
            component.startEditing(0);
            component.editingCategory!.name = '   ';

            component.saveEditing();

            expect(component.categories()[0].name).toBe('Tech');
        });

        it('should trim the name when saving', () => {
            const component = createComponent();
            component.startEditing(0);
            component.editingCategory!.name = '  Updated Tech  ';

            component.saveEditing();

            expect(component.categories()[0].name).toBe('Updated Tech');
        });
    });

    describe('deleteCategory', () => {
        it('should remove the category at the given index', () => {
            const component = createComponent();

            component.deleteCategory(0);

            expect(component.categories().length).toBe(1);
            expect(component.categories()[0].id).toBe('music');
        });

        it('should handle deleting the last category', () => {
            const component = createComponent([
                { id: 'all', name: 'All', color: '#9c27b0' },
                { id: 'only', name: 'Only', color: '#f44336' },
            ]);

            component.deleteCategory(0);

            expect(component.categories().length).toBe(0);
        });
    });

    describe('save', () => {
        it('should close the dialog with all categories including the fixed "All" category', () => {
            const component = createComponent();

            component.save();

            expect((component as any).dialogRef.close).toHaveBeenCalledWith([
                { id: 'all', name: 'All', color: '#9c27b0' },
                { id: 'tech', name: 'Tech', color: '#2196f3' },
                { id: 'music', name: 'Music', color: '#4caf50' },
            ]);
        });

        it('should include newly added categories in save', () => {
            const component = createComponent();
            component.newCategory.name = 'News';
            component.newCategory.color = '#ff9800';
            component.addCategory();

            component.save();

            const savedCategories = vi.mocked((component as any).dialogRef.close).mock.lastCall[0];
            expect(savedCategories.length).toBe(4);
            expect(savedCategories[0].id).toBe('all');
            expect(savedCategories[3]).toEqual({ id: 'news', name: 'News', color: '#ff9800' });
        });

        it('should save only the "All" category when all custom categories are deleted', () => {
            const component = createComponent();
            component.deleteCategory(1);
            component.deleteCategory(0);

            component.save();

            expect((component as any).dialogRef.close).toHaveBeenCalledWith([
                { id: 'all', name: 'All', color: '#9c27b0' },
            ]);
        });
    });
});
