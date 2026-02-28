import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavigationComponent } from './navigation';
import { RouteDataService } from '../../services/route-data.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { signal } from '@angular/core';
import type { HomeDestination } from '../../services/local-settings.service';

describe('NavigationComponent', () => {
  let component: NavigationComponent;
  let fixture: ComponentFixture<NavigationComponent>;
  let mockRouter: Pick<Router, 'navigate' | 'url'>;
  let mockRouteDataService: Pick<RouteDataService, 'clearHistory' | 'canGoBack' | 'goBack' | 'currentRouteData' | 'goToHistoryItem'>;
  let mockLocalSettings: Pick<LocalSettingsService, 'homeDestination' | 'firstMenuItemPath'>;
  let mockPanelNav: Pick<PanelNavigationService, 'closeRight' | 'clearLeftStack'>;

  const homeDestinationSignal = signal<HomeDestination>('first-menu-item');
  const firstMenuItemPathSignal = signal('summary');

  beforeEach(async () => {
    mockRouter = {
      navigate: vi.fn().mockName("Router.navigate"),
      url: '/'
    } as unknown as Pick<Router, 'navigate' | 'url'>;
    mockRouteDataService = {
      clearHistory: vi.fn().mockName("RouteDataService.clearHistory"),
      canGoBack: signal(false),
      goBack: vi.fn().mockName("RouteDataService.goBack"),
      currentRouteData: signal({}),
      goToHistoryItem: vi.fn().mockName('RouteDataService.goToHistoryItem')
    } as unknown as Pick<RouteDataService, 'clearHistory' | 'canGoBack' | 'goBack' | 'currentRouteData' | 'goToHistoryItem'>;
    mockLocalSettings = {
      homeDestination: homeDestinationSignal,
      firstMenuItemPath: firstMenuItemPathSignal
    } as unknown as Pick<LocalSettingsService, 'homeDestination' | 'firstMenuItemPath'>;
    mockPanelNav = {
      closeRight: vi.fn().mockName("PanelNavigationService.closeRight"),
      clearLeftStack: vi.fn().mockName("PanelNavigationService.clearLeftStack")
    } as unknown as Pick<PanelNavigationService, 'closeRight' | 'clearLeftStack'>;

    await TestBed.configureTestingModule({
      imports: [NavigationComponent],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: RouteDataService, useValue: mockRouteDataService },
        { provide: LocalSettingsService, useValue: mockLocalSettings },
        { provide: PanelNavigationService, useValue: mockPanelNav },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavigationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('navigateToHome', () => {
    it('should navigate to absolute path when firstMenuItemPath returns relative path', () => {
      // Setup: Mock firstMenuItemPath to return 'summary' (relative path)
      firstMenuItemPathSignal.set('summary');
      homeDestinationSignal.set('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/summary'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/summary']);
      expect(mockRouteDataService.clearHistory).toHaveBeenCalled();
      expect(mockPanelNav.closeRight).toHaveBeenCalled();
      expect(mockPanelNav.clearLeftStack).toHaveBeenCalled();
    });

    it('should close right panel and clear left stack before navigating', () => {
      // Setup
      homeDestinationSignal.set('feeds');

      // Execute
      component.navigateToHome();

      // Verify: Panels should be cleared to return to clean state
      expect(mockPanelNav.closeRight).toHaveBeenCalled();
      expect(mockPanelNav.clearLeftStack).toHaveBeenCalled();
    });

    it('should navigate to absolute path when firstMenuItemPath returns path with slash', () => {
      // Setup: Mock firstMenuItemPath to return '/f' (already absolute)
      firstMenuItemPathSignal.set('/f');
      homeDestinationSignal.set('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/f' (not '//f')
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/f']);
    });

    it('should navigate to feeds when homeDestination is feeds', () => {
      // Setup
      homeDestinationSignal.set('feeds');

      // Execute
      component.navigateToHome();

      // Verify
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/f']);
    });

    it('should navigate to home when homeDestination is home', () => {
      // Setup
      homeDestinationSignal.set('home');

      // Execute
      component.navigateToHome();

      // Verify
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should convert articles to absolute path', () => {
      // Setup: Mock firstMenuItemPath to return 'articles'
      firstMenuItemPathSignal.set('articles');
      homeDestinationSignal.set('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/articles'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/articles']);
    });

    it('should convert messages to absolute path', () => {
      // Setup: Mock firstMenuItemPath to return 'messages'
      firstMenuItemPathSignal.set('messages');
      homeDestinationSignal.set('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/messages'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/messages']);
    });
  });
});
