import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, beforeEach, it, vi } from 'vitest';

import { PanelNavigationService } from './panel-navigation.service';
import { PanelActionsService } from './panel-actions.service';
import { LoggerService } from './logger.service';

@Component({
  template: '',
})
class TestPrimaryComponent { }

@Component({
  template: '',
})
class TestRightPanelComponent { }

describe('PanelNavigationService', () => {
  let service: PanelNavigationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'articles', component: TestPrimaryComponent },
          { path: 'a/:id', outlet: 'right', component: TestRightPanelComponent },
        ]),
        {
          provide: BreakpointObserver,
          useValue: {
            observe: () => of({ matches: false }),
          },
        },
        {
          provide: PanelActionsService,
          useValue: {
            clearPageTitle: vi.fn(),
            clearLeftPanelActions: vi.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(PanelNavigationService);
    service.setClearRightPanelCallback(() => undefined);
  });

  it('preserves an auxiliary article route on initial navigation', () => {
    service.handleInitialRoute('/articles(right:a/naddr1example)');

    expect(service.leftRoute()?.path).toBe('articles');
    expect(service.rightRoute()?.path).toBe('a/naddr1example');
    expect(service.hasRightContent()).toBe(true);
  });
});