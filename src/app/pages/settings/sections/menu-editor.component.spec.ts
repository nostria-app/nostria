import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DEFAULT_MENU_ITEM_IDS,
  LocalSettingsService,
  MenuItemConfig,
} from '../../../services/local-settings.service';
import { SettingsService } from '../../../services/settings.service';
import { SettingMenuEditorComponent } from './menu-editor.component';

describe('SettingMenuEditorComponent', () => {
  let component: SettingMenuEditorComponent;
  let fixture: ComponentFixture<SettingMenuEditorComponent>;
  let menuItemsSignal: ReturnType<typeof signal<MenuItemConfig[]>>;
  let mockLocalSettings: Pick<LocalSettingsService, 'menuItems'>;
  let mockSettings: Pick<SettingsService, 'resetMenuItems' | 'updateMenuItems'>;

  beforeEach(async () => {
    menuItemsSignal = signal<MenuItemConfig[]>([]);
    mockLocalSettings = {
      menuItems: menuItemsSignal,
    } as Pick<LocalSettingsService, 'menuItems'>;
    mockSettings = {
      resetMenuItems: vi.fn().mockResolvedValue(undefined),
      updateMenuItems: vi.fn().mockResolvedValue(undefined),
    } as Pick<SettingsService, 'resetMenuItems' | 'updateMenuItems'>;

    await TestBed.configureTestingModule({
      imports: [SettingMenuEditorComponent],
      providers: [
        { provide: LocalSettingsService, useValue: mockLocalSettings },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingMenuEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('uses the shared default menu configuration when no custom config exists', () => {
    expect(component.activeItems().map(item => item.id)).toEqual([...DEFAULT_MENU_ITEM_IDS]);
  });

  it('reacts to external menu config changes', () => {
    menuItemsSignal.set([
      { id: 'music', visible: true },
      { id: '/f', visible: false },
    ]);
    fixture.detectChanges();

    expect(component.activeItems().map(item => item.id)).toEqual(['music']);
    expect(component.hiddenItems().some(item => item.id === '/f')).toBe(true);
  });

  it('delegates reset through SettingsService', () => {
    component.resetToDefault();

    expect(mockSettings.resetMenuItems).toHaveBeenCalled();
  });
});