import { TestBed } from '@angular/core/testing';
import { FollowingBackupService } from './following-backup.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { DatabaseService } from './database.service';
import { signal } from '@angular/core';

describe('FollowingBackupService', () => {
  let service: FollowingBackupService;
  let mockNostrService: Pick<NostrService, 'createEvent' | 'signAndPublish'>;
  let mockLoggerService: Pick<LoggerService, 'info' | 'warn' | 'error' | 'debug'>;
  let mockAccountStateService: Pick<AccountStateService, 'pubkey' | 'followingList' | 'followingListLoaded'>;
  let mockLocalStorageService: Pick<LocalStorageService, 'getItem' | 'setItem' | 'removeItem'>;
  let mockDatabaseService: Pick<DatabaseService, 'getEventByPubkeyAndKind'>;

  beforeEach(() => {
    // Create mock services
    mockNostrService = {
      createEvent: vi.fn().mockName("NostrService.createEvent"),
      signAndPublish: vi.fn().mockName("NostrService.signAndPublish")
    };
    mockLoggerService = {
      info: vi.fn().mockName("LoggerService.info"),
      warn: vi.fn().mockName("LoggerService.warn"),
      error: vi.fn().mockName("LoggerService.error"),
      debug: vi.fn().mockName("LoggerService.debug")
    };
    mockAccountStateService = {
      pubkey: signal(''),
      followingList: signal<string[]>([]),
      followingListLoaded: signal(false)
    };
    mockLocalStorageService = {
      getItem: vi.fn().mockName("LocalStorageService.getItem"),
      setItem: vi.fn().mockName("LocalStorageService.setItem"),
      removeItem: vi.fn().mockName("LocalStorageService.removeItem")
    };
    mockDatabaseService = {
      getEventByPubkeyAndKind: vi.fn().mockName("DatabaseService.getEventByPubkeyAndKind")
    };

    TestBed.configureTestingModule({
      providers: [
        FollowingBackupService,
        { provide: NostrService, useValue: mockNostrService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: AccountStateService, useValue: mockAccountStateService },
        { provide: LocalStorageService, useValue: mockLocalStorageService },
        { provide: DatabaseService, useValue: mockDatabaseService },
      ],
    });

    service = TestBed.inject(FollowingBackupService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return empty array when no backups exist', () => {
    vi.mocked(mockLocalStorageService.getItem).mockReturnValue(null);
    const backups = service.getBackups();
    expect(backups).toEqual([]);
  });

  it('should return parsed backups from localStorage', () => {
    const mockBackups = [
      {
        id: 'test-1',
        timestamp: Date.now(),
        pubkeys: ['pubkey1', 'pubkey2'],
        event: { id: 'event1' } as any,
      },
    ];
    vi.mocked(mockLocalStorageService.getItem).mockReturnValue(JSON.stringify(mockBackups));
    const backups = service.getBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].id).toBe('test-1');
  });

  it('should handle invalid JSON in localStorage', () => {
    vi.mocked(mockLocalStorageService.getItem).mockReturnValue('invalid json');
    const backups = service.getBackups();
    expect(backups).toEqual([]);
    expect(mockLoggerService.error).toHaveBeenCalled();
  });

  it('should delete a backup', () => {
    const mockBackups = [
      {
        id: 'test-1',
        timestamp: Date.now(),
        pubkeys: ['pubkey1'],
        event: { id: 'event1' } as any,
      },
      {
        id: 'test-2',
        timestamp: Date.now(),
        pubkeys: ['pubkey2'],
        event: { id: 'event2' } as any,
      },
    ];
    vi.mocked(mockLocalStorageService.getItem).mockReturnValue(JSON.stringify(mockBackups));

    const result = service.deleteBackup('test-1');

    expect(result).toBe(true);
    expect(mockLocalStorageService.setItem).toHaveBeenCalledWith('nostria-following-history', expect.stringContaining('test-2'));
  });

  it('should clear all backups', () => {
    service.clearAllBackups();
    expect(mockLocalStorageService.removeItem).toHaveBeenCalledWith('nostria-following-history');
  });
});
