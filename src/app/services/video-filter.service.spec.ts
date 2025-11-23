import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { VideoFilterService } from './video-filter.service';

describe('VideoFilterService', () => {
  let service: VideoFilterService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        VideoFilterService,
      ],
    }).compileComponents();

    service = TestBed.inject(VideoFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have 14 available filters', () => {
    expect(service.availableFilters.length).toBe(14);
  });

  it('should include required filters', () => {
    const filterIds = service.availableFilters.map(f => f.id);
    expect(filterIds).toContain('none');
    expect(filterIds).toContain('grayscale');
    expect(filterIds).toContain('sepia');
    expect(filterIds).toContain('cartoon');
    expect(filterIds).toContain('edge');
    expect(filterIds).toContain('blur');
  });

  it('should set filter correctly', () => {
    service.setFilter('grayscale');
    expect(service.getFilterIndex('grayscale')).toBe(1);
  });

  it('should return correct filter index', () => {
    expect(service.getFilterIndex('none')).toBe(0);
    expect(service.getFilterIndex('grayscale')).toBe(1);
    expect(service.getFilterIndex('sepia')).toBe(2);
  });

  it('should have valid filter metadata', () => {
    service.availableFilters.forEach(filter => {
      expect(filter.id).toBeTruthy();
      expect(filter.name).toBeTruthy();
      expect(filter.icon).toBeTruthy();
      expect(filter.description).toBeTruthy();
    });
  });
});
