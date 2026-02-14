import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavigationComponent } from './navigation';
import { RouteDataService } from '../../services/route-data.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { signal } from '@angular/core';

describe('NavigationComponent', () => {
  let component: NavigationComponent;
  let fixture: ComponentFixture<NavigationComponent>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockRouteDataService: jasmine.SpyObj<RouteDataService>;
  let mockLocalSettings: jasmine.SpyObj<LocalSettingsService>;

  beforeEach(async () => {
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockRouteDataService = jasmine.createSpyObj('RouteDataService', ['clearHistory', 'canGoBack', 'goBack']);
    mockLocalSettings = jasmine.createSpyObj('LocalSettingsService', [], {
      homeDestination: signal('first-menu-item'),
      firstMenuItemPath: signal('summary'),
    });

    await TestBed.configureTestingModule({
      imports: [NavigationComponent],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: RouteDataService, useValue: mockRouteDataService },
        { provide: LocalSettingsService, useValue: mockLocalSettings },
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
      (mockLocalSettings as any).firstMenuItemPath = signal('summary');
      (mockLocalSettings as any).homeDestination = signal('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/summary'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/summary']);
      expect(mockRouteDataService.clearHistory).toHaveBeenCalled();
    });

    it('should navigate to absolute path when firstMenuItemPath returns path with slash', () => {
      // Setup: Mock firstMenuItemPath to return '/f' (already absolute)
      (mockLocalSettings as any).firstMenuItemPath = signal('/f');
      (mockLocalSettings as any).homeDestination = signal('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/f' (not '//f')
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/f']);
    });

    it('should navigate to feeds when homeDestination is feeds', () => {
      // Setup
      (mockLocalSettings as any).homeDestination = signal('feeds');

      // Execute
      component.navigateToHome();

      // Verify
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/f']);
    });

    it('should navigate to home when homeDestination is home', () => {
      // Setup
      (mockLocalSettings as any).homeDestination = signal('home');

      // Execute
      component.navigateToHome();

      // Verify
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should convert articles to absolute path', () => {
      // Setup: Mock firstMenuItemPath to return 'articles'
      (mockLocalSettings as any).firstMenuItemPath = signal('articles');
      (mockLocalSettings as any).homeDestination = signal('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/articles'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/articles']);
    });

    it('should convert messages to absolute path', () => {
      // Setup: Mock firstMenuItemPath to return 'messages'
      (mockLocalSettings as any).firstMenuItemPath = signal('messages');
      (mockLocalSettings as any).homeDestination = signal('first-menu-item');

      // Execute
      component.navigateToHome();

      // Verify: Router should be called with absolute path '/messages'
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/messages']);
    });
  });
});
