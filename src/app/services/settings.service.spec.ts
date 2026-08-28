import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsService } from './settings.service';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { LocalSettingsService } from './local-settings.service';

describe('SettingsService.toggleRightSidebar', () => {
  let service: SettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SettingsService,
        { provide: NostrService, useValue: {} },
        {
          provide: AccountStateService,
          useValue: {
            account: signal(null),
            initialized: signal(true),
            pubkey: signal(null),
          },
        },
        { provide: AccountRelayService, useValue: {} },
        { provide: DatabaseService, useValue: {} },
        {
          provide: LoggerService,
          useValue: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
        },
        {
          provide: LocalSettingsService,
          useValue: { setRelayDiscoveryMode: vi.fn(), setMenuItems: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(SettingsService);
  });

  it('enables the right sidebar when it is unset', async () => {
    const update = vi.spyOn(service, 'updateSettings').mockResolvedValue();
    service.settings.update(current => ({ ...current, rightSidebarEnabled: undefined }));

    await service.toggleRightSidebar();

    expect(update).toHaveBeenCalledWith({ rightSidebarEnabled: true });
  });

  it('disables the right sidebar when it is on', async () => {
    const update = vi.spyOn(service, 'updateSettings').mockResolvedValue();
    service.settings.update(current => ({ ...current, rightSidebarEnabled: true }));

    await service.toggleRightSidebar();

    expect(update).toHaveBeenCalledWith({ rightSidebarEnabled: false });
  });
});
