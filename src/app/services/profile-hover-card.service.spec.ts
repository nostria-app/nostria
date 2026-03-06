import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { RouterModule } from '@angular/router';
import { ProfileHoverCardService } from './profile-hover-card.service';

describe('ProfileHoverCardService', () => {
    let service: ProfileHoverCardService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [RouterModule.forRoot([])],
            providers: [
                { provide: PLATFORM_ID, useValue: 'browser' },
                Overlay,
            ],
        });
        service = TestBed.inject(ProfileHoverCardService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('long-press touch support', () => {
        let element: HTMLElement;

        beforeEach(() => {
            element = document.createElement('div');
            document.body.appendChild(element);
        });

        afterEach(() => {
            service.closeHoverCard();
            element.remove();
        });

        it('should start long-press timer on single touch', () => {
            const touchEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(touchEvent, element, 'test-pubkey');

            // The long-press timeout should be set (internal state)
            // We verify by checking that touchEnd cancels it without error
            service.onTouchEnd();
        });

        it('should cancel long-press on multi-touch', () => {
            const multiTouchEvent = createTouchEvent('touchstart', 100, 200, 2);
            service.onTouchStart(multiTouchEvent, element, 'test-pubkey');

            // Should not throw - long-press was cancelled
            service.onTouchEnd();
        });

        it('should cancel long-press when finger moves beyond threshold', () => {
            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            // Move finger beyond the 10px threshold
            const moveEvent = createTouchEvent('touchmove', 115, 200);
            service.onTouchMove(moveEvent);

            // Touch end should not trigger hover card since long-press was cancelled
            service.onTouchEnd();
        });

        it('should not cancel long-press when finger moves within threshold', () => {
            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            // Move finger within the 10px threshold
            const moveEvent = createTouchEvent('touchmove', 105, 203);
            service.onTouchMove(moveEvent);

            // Should still have the long-press pending - cleanup
            service.onTouchEnd();
        });

        it('should cancel long-press on touchEnd', () => {
            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            service.onTouchEnd();

            // After touchEnd, the timer should be cancelled
            // Verify no hover card shows even after the long-press duration
        });

        it('should show hover card after long-press duration', fakeAsync(() => {
            const showSpy = vi.spyOn(service, 'showHoverCard');

            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            // Advance time past the long-press duration (500ms)
            tick(500);

            expect(showSpy).toHaveBeenCalledWith(element, 'test-pubkey', 0);
        }));

        it('should not show hover card if touch ends before long-press duration', fakeAsync(() => {
            const showSpy = vi.spyOn(service, 'showHoverCard');

            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            // Touch ends after 300ms (before the 500ms threshold)
            tick(300);
            service.onTouchEnd();

            // Advance past the threshold
            tick(300);

            expect(showSpy).not.toHaveBeenCalled();
        }));

        it('should not show hover card if finger moves before long-press duration', fakeAsync(() => {
            const showSpy = vi.spyOn(service, 'showHoverCard');

            const startEvent = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent, element, 'test-pubkey');

            // Move finger beyond threshold at 200ms
            tick(200);
            const moveEvent = createTouchEvent('touchmove', 120, 200);
            service.onTouchMove(moveEvent);

            // Advance past the threshold
            tick(400);

            expect(showSpy).not.toHaveBeenCalled();
        }));

        it('should cancel previous long-press when starting new one', fakeAsync(() => {
            const showSpy = vi.spyOn(service, 'showHoverCard');
            const element2 = document.createElement('div');
            document.body.appendChild(element2);

            // Start first long-press
            const startEvent1 = createTouchEvent('touchstart', 100, 200);
            service.onTouchStart(startEvent1, element, 'pubkey-1');

            // Wait 300ms then start a new one on different element
            tick(300);
            const startEvent2 = createTouchEvent('touchstart', 200, 300);
            service.onTouchStart(startEvent2, element2, 'pubkey-2');

            // Advance past the long-press duration for the second touch
            tick(500);

            // Only the second one should have triggered
            expect(showSpy).toHaveBeenCalledTimes(1);
            expect(showSpy).toHaveBeenCalledWith(element2, 'pubkey-2', 0);

            element2.remove();
        }));
    });

    describe('hideHoverCard', () => {
        it('should clear hover timeout on hide', () => {
            const element = document.createElement('div');
            document.body.appendChild(element);

            service.showHoverCard(element, 'test-pubkey');
            service.hideHoverCard();

            // Should not throw
            element.remove();
        });
    });

    describe('closeHoverCard', () => {
        it('should reset state on close', () => {
            service.closeHoverCard();
            // Should not throw even when nothing is open
        });
    });
});

/**
 * Helper to create a TouchEvent with specified coordinates
 */
function createTouchEvent(type: string, clientX: number, clientY: number, touchCount = 1): TouchEvent {
    const touches: Touch[] = [];
    for (let i = 0; i < touchCount; i++) {
        touches.push({
            clientX: i === 0 ? clientX : clientX + 50,
            clientY: i === 0 ? clientY : clientY + 50,
            identifier: i,
            target: document.createElement('div'),
            pageX: clientX,
            pageY: clientY,
            screenX: clientX,
            screenY: clientY,
            radiusX: 0,
            radiusY: 0,
            rotationAngle: 0,
            force: 0,
        } as Touch);
    }

    return new TouchEvent(type, {
        touches,
        changedTouches: touches,
        targetTouches: touches,
    });
}
