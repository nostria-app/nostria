import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AboutComponent } from './about.component';
import { RightPanelService } from '../../../services/right-panel.service';
import { ApplicationService } from '../../../services/application.service';
import { LayoutService } from '../../../services/layout.service';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;
  let mockRightPanel: jasmine.SpyObj<RightPanelService>;
  let mockLocation: jasmine.SpyObj<Location>;

  beforeEach(async () => {
    mockRightPanel = jasmine.createSpyObj('RightPanelService', ['goBack'], {
      hasContent: signal(false),
    });
    mockLocation = jasmine.createSpyObj('Location', ['back']);

    const mockApp = {
      isBrowser: signal(false),
      version: '1.0.0',
    };

    const mockLayout = {
      showWelcomeScreen: signal(false),
    };

    await TestBed.configureTestingModule({
      imports: [AboutComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RightPanelService, useValue: mockRightPanel },
        { provide: Location, useValue: mockLocation },
        { provide: ApplicationService, useValue: mockApp },
        { provide: LayoutService, useValue: mockLayout },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('goBack', () => {
    it('should use location.back() when right panel has no content', () => {
      (mockRightPanel.hasContent as unknown as ReturnType<typeof signal>).set(false);

      component.goBack();

      expect(mockLocation.back).toHaveBeenCalled();
      expect(mockRightPanel.goBack).not.toHaveBeenCalled();
    });

    it('should use rightPanel.goBack() when right panel has content', () => {
      (mockRightPanel.hasContent as unknown as ReturnType<typeof signal>).set(true);

      component.goBack();

      expect(mockRightPanel.goBack).toHaveBeenCalled();
      expect(mockLocation.back).not.toHaveBeenCalled();
    });
  });
});
