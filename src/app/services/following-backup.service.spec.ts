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
  let mockNostrService: jasmine.SpyObj<NostrService>;
  let mockLoggerService: jasmine.SpyObj<LoggerService>;
  let mockAccountStateService: jasmine.SpyObj<AccountStateService>;
  let mockLocalStorageService: jasmine.SpyObj<LocalStorageService>;
  let mockDatabaseService: jasmine.SpyObj<DatabaseService>;

  beforeEach(() => {
    // Create mock services
    mockNostrService = jasmine.createSpyObj('NostrService', ['createEvent', 'signAndPublish']);
    mockLoggerService = jasmine.createSpyObj('LoggerService', ['info', 'warn', 'error', 'debug']);
    mockAccountStateService = jasmine.createSpyObj('AccountStateService', ['pubkey', 'followingList', 'account']);
    mockLocalStorageService = jasmine.createSpyObj('LocalStorageService', ['getItem', 'setItem', 'removeItem']);
    mockDatabaseService = jasmine.createSpyObj('DatabaseService', ['getEventByPubkeyAndKind']);

    // Setup signal mocks
    (mockAccountStateService.pubkey as any) = signal(null);
    (mockAccountStateService.followingList as any) = signal([]);
    (mockAccountStateService.account as any) = signal(null);

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
    mockLocalStorageService.getItem.and.returnValue(null);
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
    mockLocalStorageService.getItem.and.returnValue(JSON.stringify(mockBackups));
    const backups = service.getBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].id).toBe('test-1');
  });

  it('should handle invalid JSON in localStorage', () => {
    mockLocalStorageService.getItem.and.returnValue('invalid json');
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
    mockLocalStorageService.getItem.and.returnValue(JSON.stringify(mockBackups));

    const result = service.deleteBackup('test-1');

    expect(result).toBe(true);
    expect(mockLocalStorageService.setItem).toHaveBeenCalledWith(
      'nostria-following-history',
      jasmine.stringContaining('test-2')
    );
  });

  it('should clear all backups', () => {
    service.clearAllBackups();
    expect(mockLocalStorageService.removeItem).toHaveBeenCalledWith('nostria-following-history');
  });
});
