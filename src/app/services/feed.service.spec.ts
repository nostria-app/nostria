import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { FeedService } from './feed.service';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { RelayService } from './relays/relay';
import { ApplicationStateService } from './application-state.service';
import { AccountStateService } from './account-state.service';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';

describe('FeedService', () => {
  let service: FeedService;

  // Mock services
  const mockLocalStorageService = jasmine.createSpyObj('LocalStorageService', [
    'getItem',
    'setItem',
  ]);
  const mockLoggerService = jasmine.createSpyObj('LoggerService', [
    'log',
    'error',
    'warn',
  ]);
  const mockRelayService = jasmine.createSpyObj('RelayService', ['getPool']);
  const mockApplicationStateService = jasmine.createSpyObj(
    'ApplicationStateService',
    ['state']
  );
  const mockAccountStateService = jasmine.createSpyObj('AccountStateService', [
    'state',
  ]);
  const mockDataService = jasmine.createSpyObj('DataService', ['getData']);
  const mockUtilitiesService = jasmine.createSpyObj('UtilitiesService', [
    'utils',
  ]);
  const mockApplicationService = jasmine.createSpyObj('ApplicationService', [
    'app',
  ]);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        FeedService,
        { provide: LocalStorageService, useValue: mockLocalStorageService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: RelayService, useValue: mockRelayService },
        {
          provide: ApplicationStateService,
          useValue: mockApplicationStateService,
        },
        { provide: AccountStateService, useValue: mockAccountStateService },
        { provide: DataService, useValue: mockDataService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: ApplicationService, useValue: mockApplicationService },
      ],
    }).compileComponents();

    service = TestBed.inject(FeedService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
