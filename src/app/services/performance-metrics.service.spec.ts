import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { PerformanceMetricsService } from './performance-metrics.service';

describe('PerformanceMetricsService', () => {
    let service: PerformanceMetricsService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                PerformanceMetricsService,
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });
        service = TestBed.inject(PerformanceMetricsService);
    });

    afterEach(() => {
        service.reset();
    });

    describe('startTimer / endTimer', () => {
        it('should record a timing when start and end are called', () => {
            service.startTimer('test.op');
            const duration = service.endTimer('test.op');
            expect(duration).toBeGreaterThanOrEqual(0);

            const stats = service.getTimingStats('test.op');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
            expect(stats!.totalTime).toBeGreaterThanOrEqual(0);
        });

        it('should return -1 when ending a timer that was never started', () => {
            const duration = service.endTimer('nonexistent');
            expect(duration).toBe(-1);
        });

        it('should remove the active timer after endTimer', () => {
            service.startTimer('test.op');
            service.endTimer('test.op');
            // Calling endTimer again should return -1 since timer was already consumed
            const duration = service.endTimer('test.op');
            expect(duration).toBe(-1);
        });

        it('should record multiple timings for the same key', () => {
            for (let i = 0; i < 5; i++) {
                service.startTimer('multi');
                service.endTimer('multi');
            }
            const stats = service.getTimingStats('multi');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(5);
        });
    });

    describe('recordTiming', () => {
        it('should record a timing directly', () => {
            service.recordTiming('direct.op', 42.5);
            const stats = service.getTimingStats('direct.op');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
            expect(stats!.avgTime).toBe(42.5);
            expect(stats!.minTime).toBe(42.5);
            expect(stats!.maxTime).toBe(42.5);
        });

        it('should compute correct stats for multiple values', () => {
            service.recordTiming('multi', 10);
            service.recordTiming('multi', 20);
            service.recordTiming('multi', 30);
            service.recordTiming('multi', 40);
            service.recordTiming('multi', 50);

            const stats = service.getTimingStats('multi');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(5);
            expect(stats!.totalTime).toBe(150);
            expect(stats!.avgTime).toBe(30);
            expect(stats!.minTime).toBe(10);
            expect(stats!.maxTime).toBe(50);
            expect(stats!.medianTime).toBe(30);
            expect(stats!.lastTime).toBe(50);
        });
    });

    describe('measure', () => {
        it('should measure a synchronous function and return its result', () => {
            const result = service.measure('sync.op', () => 42);
            expect(result).toBe(42);

            const stats = service.getTimingStats('sync.op');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
        });

        it('should record timing even if function throws', () => {
            expect(() => service.measure('throws', () => {
                throw new Error('boom');
            })).toThrowError('boom');

            const stats = service.getTimingStats('throws');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
        });
    });

    describe('measureAsync', () => {
        it('should measure an async function and return its result', async () => {
            const result = await service.measureAsync('async.op', async () => {
                return 'hello';
            });
            expect(result).toBe('hello');

            const stats = service.getTimingStats('async.op');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
        });

        it('should record timing even if async function rejects', async () => {
            await expect(service.measureAsync('async.throws', async () => {
                throw new Error('async boom');
            })).rejects.toThrowError('async boom');

            const stats = service.getTimingStats('async.throws');
            expect(stats).toBeTruthy();
            expect(stats!.count).toBe(1);
        });
    });

    describe('incrementCounter / getCounter', () => {
        it('should start at 0 for unknown counters', () => {
            expect(service.getCounter('unknown')).toBe(0);
        });

        it('should increment by 1 by default', () => {
            service.incrementCounter('events');
            expect(service.getCounter('events')).toBe(1);
            service.incrementCounter('events');
            expect(service.getCounter('events')).toBe(2);
        });

        it('should increment by a custom amount', () => {
            service.incrementCounter('bytes', 1024);
            expect(service.getCounter('bytes')).toBe(1024);
            service.incrementCounter('bytes', 512);
            expect(service.getCounter('bytes')).toBe(1536);
        });
    });

    describe('getSnapshot', () => {
        it('should return an empty snapshot initially', () => {
            const snap = service.getSnapshot();
            expect(snap.timings.length).toBe(0);
            expect(snap.counters.length).toBe(0);
            expect(snap.uptime).toBeGreaterThanOrEqual(0);
            expect(snap.collectedAt).toBeGreaterThan(0);
        });

        it('should include all timings and counters', () => {
            service.recordTiming('op.a', 10);
            service.recordTiming('op.b', 20);
            service.incrementCounter('counter.x');
            service.incrementCounter('counter.y', 5);

            const snap = service.getSnapshot();
            expect(snap.timings.length).toBe(2);
            expect(snap.counters.length).toBe(2);
        });

        it('should sort timings by total time descending', () => {
            service.recordTiming('fast', 1);
            service.recordTiming('slow', 100);

            const snap = service.getSnapshot();
            expect(snap.timings[0].name).toBe('slow');
            expect(snap.timings[1].name).toBe('fast');
        });

        it('should sort counters by count descending', () => {
            service.incrementCounter('few', 1);
            service.incrementCounter('many', 100);

            const snap = service.getSnapshot();
            expect(snap.counters[0].name).toBe('many');
            expect(snap.counters[1].name).toBe('few');
        });
    });

    describe('getReport', () => {
        it('should return a string report', () => {
            service.recordTiming('relay.get', 25);
            service.incrementCounter('events.received', 10);

            const report = service.getReport();
            expect(typeof report).toBe('string');
            expect(report).toContain('Performance Metrics Report');
            expect(report).toContain('relay.get');
            expect(report).toContain('events.received');
        });
    });

    describe('reset', () => {
        it('should clear all timings and counters', () => {
            service.recordTiming('op', 10);
            service.incrementCounter('count');

            service.reset();

            expect(service.getTimingStats('op')).toBeNull();
            expect(service.getCounter('count')).toBe(0);
            const snap = service.getSnapshot();
            expect(snap.timings.length).toBe(0);
            expect(snap.counters.length).toBe(0);
        });
    });

    describe('snapshot signal', () => {
        it('should be reactive and update when metrics change', () => {
            const snap1 = service.snapshot();
            expect(snap1.timings.length).toBe(0);

            service.recordTiming('test', 5);
            const snap2 = service.snapshot();
            expect(snap2.timings.length).toBe(1);
        });
    });

    describe('SSR safety', () => {
        it('should be safe on server platform', () => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    PerformanceMetricsService,
                    { provide: PLATFORM_ID, useValue: 'server' },
                ],
            });
            const serverService = TestBed.inject(PerformanceMetricsService);

            // These should not throw
            serverService.startTimer('test');
            const duration = serverService.endTimer('test');
            expect(duration).toBe(-1);

            // Counters should still work (no browser API dependency)
            serverService.incrementCounter('test');
            expect(serverService.getCounter('test')).toBe(1);

            // Snapshot should have null memory
            const snap = serverService.getSnapshot();
            expect(snap.memoryUsage).toBeNull();
        });
    });
});
