import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { MessagingService } from './messaging.service';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';

describe('MessagingService', () => {
  let service: MessagingService;

  // Mock services
  const mockNostrService = jasmine.createSpyObj('NostrService', ['getPool', 'publish']);
  const mockRelayService = jasmine.createSpyObj('RelayService', ['getPool']);
  const mockLoggerService = jasmine.createSpyObj('LoggerService', ['log', 'error', 'warn']);
  const mockAccountStateService = jasmine.createSpyObj('AccountStateService', ['state']);
  const mockUtilitiesService = jasmine.createSpyObj('UtilitiesService', ['utils']);
  const mockEncryptionService = jasmine.createSpyObj('EncryptionService', ['encrypt', 'decrypt']);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MessagingService,
        { provide: NostrService, useValue: mockNostrService },
        { provide: RelayService, useValue: mockRelayService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: AccountStateService, useValue: mockAccountStateService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: EncryptionService, useValue: mockEncryptionService }
      ]
    }).compileComponents();
    
    service = TestBed.inject(MessagingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have MESSAGE_SIZE property set to 20', () => {
    expect(service.MESSAGE_SIZE).toBe(20);
  });
});
