import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { WakeLockService } from './wake-lock.service';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';

describe('WakeLockService', () => {
    let service: WakeLockService;
    let mockWakeLock: any;
    let mockWakeLockSentinel: any;

    beforeEach(async () => {
        // Mock WakeLock API
        mockWakeLockSentinel = {
            released: false,
            release: vi.fn().mockReturnValue(Promise.resolve()),
            addEventListener: vi.fn(),
        };

        mockWakeLock = {
            request: vi.fn().mockReturnValue(Promise.resolve(mockWakeLockSentinel)),
        };

        // Add wakeLock to navigator mock
        Object.defineProperty(navigator, 'wakeLock', {
            value: mockWakeLock,
            writable: true,
            configurable: true,
        });

        await TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                WakeLockService,
                UtilitiesService,
                LoggerService,
            ],
        }).compileComponents();

        service = TestBed.inject(WakeLockService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should enable wake lock when enable() is called', async () => {
        await service.enable();
        expect(mockWakeLock.request).toHaveBeenCalledWith('screen');
        expect(service.isActive()).toBe(true);
    });

    it('should disable wake lock when disable() is called', async () => {
        await service.enable();
        await service.disable();
        expect(mockWakeLockSentinel.release).toHaveBeenCalled();
        expect(service.isActive()).toBe(false);
    });

    it('should not acquire wake lock if already acquired', async () => {
        await service.enable();
        mockWakeLock.request.mockClear();
        await service.enable();
        expect(mockWakeLock.request).not.toHaveBeenCalled();
    });

    it('should re-acquire wake lock on visibility change when enabled', async () => {
        await service.enable();
        mockWakeLock.request.mockClear();

        // Simulate page becoming hidden
        Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            writable: true,
            configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        // Simulate page becoming visible again
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            writable: true,
            configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));

        // Should attempt to re-acquire
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(mockWakeLock.request).toHaveBeenCalled();
    });

    it('should handle unsupported browsers gracefully', async () => {
        // Remove wakeLock from navigator
        Object.defineProperty(navigator, 'wakeLock', {
            value: undefined,
            writable: true,
            configurable: true,
        });

        // Create a new service instance
        const newService = new WakeLockService();

        // Should not throw errors
        await expect(newService.enable()).resolves.not.toThrow();
        await expect(newService.disable()).resolves.not.toThrow();
        expect(newService.isActive()).toBe(false);
    });
});
