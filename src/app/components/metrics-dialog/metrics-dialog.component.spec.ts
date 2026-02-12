import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { MetricsDialogComponent } from './metrics-dialog.component';
import { PerformanceMetricsService } from '../../services/performance-metrics.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';

describe('MetricsDialogComponent', () => {
  let component: MetricsDialogComponent;
  let fixture: ComponentFixture<MetricsDialogComponent>;
  let perfMetrics: PerformanceMetricsService;

  beforeEach(async () => {
    const mockDialogRef = {
      close: jasmine.createSpy('close'),
    };

    await TestBed.configureTestingModule({
      imports: [MetricsDialogComponent],
      providers: [
        PerformanceMetricsService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CustomDialogRef, useValue: mockDialogRef },
      ],
    }).compileComponents();

    perfMetrics = TestBed.inject(PerformanceMetricsService);
    fixture = TestBed.createComponent(MetricsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    perfMetrics.reset();
    component.ngOnDestroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('tabs', () => {
    it('should default to overview tab', () => {
      expect(component.activeTab()).toBe('overview');
    });

    it('should switch tabs', () => {
      component.setTab('timings');
      expect(component.activeTab()).toBe('timings');

      component.setTab('counters');
      expect(component.activeTab()).toBe('counters');

      component.setTab('overview');
      expect(component.activeTab()).toBe('overview');
    });
  });

  describe('timing sort', () => {
    it('should default sort to total', () => {
      expect(component.timingSortMode()).toBe('total');
    });

    it('should switch sort mode', () => {
      component.setTimingSort('avg');
      expect(component.timingSortMode()).toBe('avg');

      component.setTimingSort('count');
      expect(component.timingSortMode()).toBe('count');
    });
  });

  describe('expand/collapse timings', () => {
    it('should toggle timing expanded state', () => {
      expect(component.isTimingExpanded('test')).toBeFalse();

      component.toggleTimingExpanded('test');
      expect(component.isTimingExpanded('test')).toBeTrue();

      component.toggleTimingExpanded('test');
      expect(component.isTimingExpanded('test')).toBeFalse();
    });
  });

  describe('auto-refresh', () => {
    it('should default to auto-refresh enabled', () => {
      expect(component.autoRefresh()).toBeTrue();
    });

    it('should toggle auto-refresh', () => {
      component.toggleAutoRefresh();
      expect(component.autoRefresh()).toBeFalse();

      component.toggleAutoRefresh();
      expect(component.autoRefresh()).toBeTrue();
    });
  });

  describe('computed values', () => {
    it('should compute total timing ops', () => {
      expect(component.totalTimingOps()).toBe(0);

      perfMetrics.recordTiming('op.a', 10);
      perfMetrics.recordTiming('op.b', 20);
      perfMetrics.recordTiming('op.a', 30);
      component.refresh();

      expect(component.totalTimingOps()).toBe(3);
    });

    it('should compute total counter events', () => {
      expect(component.totalCounterEvents()).toBe(0);

      perfMetrics.incrementCounter('a', 5);
      perfMetrics.incrementCounter('b', 3);
      component.refresh();

      expect(component.totalCounterEvents()).toBe(8);
    });

    it('should show top 10 timings', () => {
      for (let i = 0; i < 15; i++) {
        perfMetrics.recordTiming(`op.${i}`, i * 10);
      }
      component.refresh();

      expect(component.topTimings().length).toBe(10);
    });

    it('should show top 10 counters', () => {
      for (let i = 0; i < 15; i++) {
        perfMetrics.incrementCounter(`counter.${i}`, i);
      }
      component.refresh();

      expect(component.topCounters().length).toBe(10);
    });
  });

  describe('reset', () => {
    it('should reset metrics', () => {
      perfMetrics.recordTiming('op', 10);
      perfMetrics.incrementCounter('count');
      component.refresh();

      expect(component.totalTimingOps()).toBe(1);
      expect(component.totalCounterEvents()).toBe(1);

      component.resetMetrics();

      expect(component.totalTimingOps()).toBe(0);
      expect(component.totalCounterEvents()).toBe(0);
    });
  });

  describe('formatting helpers', () => {
    it('should format milliseconds', () => {
      expect(component.formatMs(0)).toBe('0ms');
      expect(component.formatMs(0.005)).toBe('<0.01ms');
      expect(component.formatMs(0.5)).toBe('0.50ms');
      expect(component.formatMs(5.5)).toBe('5.5ms');
      expect(component.formatMs(500)).toBe('500ms');
      expect(component.formatMs(1500)).toBe('1.50s');
    });

    it('should format rates', () => {
      expect(component.formatRate(0)).toBe('0');
      expect(component.formatRate(0.05)).toBe('0.05');
      expect(component.formatRate(0.5)).toBe('0.5');
      expect(component.formatRate(5)).toBe('5');
    });

    it('should format durations', () => {
      expect(component.formatDuration(5000)).toBe('5s');
      expect(component.formatDuration(90000)).toBe('1m 30s');
      expect(component.formatDuration(3700000)).toBe('1h 1m');
    });

    it('should format bytes', () => {
      expect(component.formatBytes(500)).toBe('500B');
      expect(component.formatBytes(2048)).toBe('2.0KB');
      expect(component.formatBytes(5 * 1024 * 1024)).toBe('5.0MB');
    });

    it('should compute bar width', () => {
      expect(component.getBarWidth(50, 100)).toBe(50);
      expect(component.getBarWidth(100, 100)).toBe(100);
      expect(component.getBarWidth(200, 100)).toBe(100); // capped at 100
      expect(component.getBarWidth(0, 0)).toBe(0);
    });
  });
});
