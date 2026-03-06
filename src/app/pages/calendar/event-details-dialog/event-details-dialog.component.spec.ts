/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { EventDetailsDialogComponent, EventDetailsDialogData } from './event-details-dialog.component';

function createMockEvent(): EventDetailsDialogData['event'] {
    return {
        id: 'event-123',
        pubkey: 'pubkey-abc',
        created_at: 1700000000,
        kind: 31922,
        content: 'Test event description',
        tags: [['t', 'nostr'], ['t', 'meetup']],
        title: 'Nostr Meetup',
        summary: 'A fun meetup',
        image: 'https://example.com/image.jpg',
        location: 'Berlin, Germany',
        start: new Date('2025-06-15T14:00:00Z'),
        end: new Date('2025-06-15T16:00:00Z'),
        participants: ['pubkey-1', 'pubkey-2'],
        hashtags: ['nostr', 'meetup'],
        isAllDay: false,
        status: 'accepted',
    };
}

function createComponent(overrides?: Partial<EventDetailsDialogData>): EventDetailsDialogComponent {
    const component = Object.create(EventDetailsDialogComponent.prototype) as EventDetailsDialogComponent;

    const mockData: EventDetailsDialogData = {
        event: createMockEvent(),
        canEdit: true,
        canDelete: true,
        currentUserPubkey: 'pubkey-abc',
        ...overrides,
    };

    // Initialize signals
    (component as any).isLoading = signal(false);

    // Mock injected services
    (component as any).dialogRef = {
        close: vi.fn(),
    };
    (component as any).data = mockData;
    (component as any).snackBar = {
        open: vi.fn(),
    };
    (component as any).localSettings = {
        calendarType: vi.fn().mockReturnValue('gregorian'),
    };
    (component as any).chroniaCalendar = {
        fromDate: vi.fn(),
        format: vi.fn(),
    };
    (component as any).ethiopianCalendar = {
        fromDate: vi.fn(),
        format: vi.fn(),
    };

    return component;
}

describe('EventDetailsDialogComponent', () => {
    describe('isCurrentUserEvent', () => {
        it('should return true when currentUserPubkey matches event pubkey', () => {
            const component = createComponent({ currentUserPubkey: 'pubkey-abc' });
            expect(component.isCurrentUserEvent).toBe(true);
        });

        it('should return false when currentUserPubkey does not match event pubkey', () => {
            const component = createComponent({ currentUserPubkey: 'different-pubkey' });
            expect(component.isCurrentUserEvent).toBe(false);
        });

        it('should return false when currentUserPubkey is undefined', () => {
            const component = createComponent({ currentUserPubkey: undefined });
            expect(component.isCurrentUserEvent).toBe(false);
        });
    });

    describe('canEditEvent', () => {
        it('should return true when canEdit is true and user is the event owner', () => {
            const component = createComponent({ canEdit: true, currentUserPubkey: 'pubkey-abc' });
            expect(component.canEditEvent).toBe(true);
        });

        it('should return false when canEdit is false', () => {
            const component = createComponent({ canEdit: false, currentUserPubkey: 'pubkey-abc' });
            expect(component.canEditEvent).toBe(false);
        });

        it('should return false when user is not the event owner', () => {
            const component = createComponent({ canEdit: true, currentUserPubkey: 'different-pubkey' });
            expect(component.canEditEvent).toBe(false);
        });
    });

    describe('isLocationUrl', () => {
        it('should return true for http URLs', () => {
            const component = createComponent();
            expect(component.isLocationUrl('http://example.com')).toBe(true);
        });

        it('should return true for https URLs', () => {
            const component = createComponent();
            expect(component.isLocationUrl('https://example.com/venue')).toBe(true);
        });

        it('should return false for plain text', () => {
            const component = createComponent();
            expect(component.isLocationUrl('Berlin, Germany')).toBe(false);
        });

        it('should return false for non-http protocols', () => {
            const component = createComponent();
            expect(component.isLocationUrl('ftp://example.com')).toBe(false);
        });
    });

    describe('formatTime', () => {
        it('should format a date to a time string', () => {
            const component = createComponent();
            const date = new Date('2025-06-15T14:30:00');
            const result = component.formatTime(date);
            expect(result).toContain('30');
        });
    });

    describe('formatDate', () => {
        it('should use default locale format for gregorian calendar', () => {
            const component = createComponent();
            const date = new Date('2025-06-15T14:00:00');
            const result = component.formatDate(date);
            expect(result).toContain('2025');
            expect(result).toContain('June');
        });

        it('should use chronia calendar when calendarType is chronia', () => {
            const component = createComponent();
            (component as any).localSettings.calendarType.mockReturnValue('chronia');
            (component as any).chroniaCalendar.fromDate.mockReturnValue({ year: 2025, month: 6, day: 15 });
            (component as any).chroniaCalendar.format.mockReturnValue('Chronia Date');

            const date = new Date('2025-06-15T14:00:00');
            const result = component.formatDate(date);

            expect(result).toBe('Chronia Date');
            expect((component as any).chroniaCalendar.fromDate).toHaveBeenCalledWith(date);
            expect((component as any).chroniaCalendar.format).toHaveBeenCalledWith({ year: 2025, month: 6, day: 15 }, 'full');
        });

        it('should use ethiopian calendar when calendarType is ethiopian', () => {
            const component = createComponent();
            (component as any).localSettings.calendarType.mockReturnValue('ethiopian');
            (component as any).ethiopianCalendar.fromDate.mockReturnValue({ year: 2017, month: 10, day: 8 });
            (component as any).ethiopianCalendar.format.mockReturnValue('Ethiopian Date');

            const date = new Date('2025-06-15T14:00:00');
            const result = component.formatDate(date);

            expect(result).toBe('Ethiopian Date');
            expect((component as any).ethiopianCalendar.fromDate).toHaveBeenCalledWith(date);
            expect((component as any).ethiopianCalendar.format).toHaveBeenCalledWith({ year: 2017, month: 10, day: 8 }, 'full');
        });
    });

    describe('respondToEvent', () => {
        it('should close dialog with rsvp action and accepted status', () => {
            const component = createComponent();
            component.respondToEvent('accepted');
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'rsvp',
                rsvpStatus: 'accepted',
            });
        });

        it('should close dialog with rsvp action and declined status', () => {
            const component = createComponent();
            component.respondToEvent('declined');
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'rsvp',
                rsvpStatus: 'declined',
            });
        });

        it('should close dialog with rsvp action and tentative status', () => {
            const component = createComponent();
            component.respondToEvent('tentative');
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'rsvp',
                rsvpStatus: 'tentative',
            });
        });
    });

    describe('editEvent', () => {
        it('should close dialog with edit action', () => {
            const component = createComponent();
            component.editEvent();
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'edit',
            });
        });
    });

    describe('deleteEvent', () => {
        it('should close dialog with delete action', () => {
            const component = createComponent();
            component.deleteEvent();
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'delete',
            });
        });
    });

    describe('shareEvent', () => {
        it('should close dialog with share action', () => {
            const component = createComponent();
            component.shareEvent();
            expect((component as any).dialogRef.close).toHaveBeenCalledWith({
                action: 'share',
            });
        });
    });

    describe('onImageError', () => {
        it('should hide the image element', () => {
            const component = createComponent();
            const mockImg = { style: { display: '' } };
            const mockEvent = { target: mockImg } as unknown as Event;

            component.onImageError(mockEvent);

            expect(mockImg.style.display).toBe('none');
        });
    });

    describe('copyEventData', () => {
        it('should show success snackbar when clipboard write succeeds', () => {
            const component = createComponent();

            // Mock navigator.clipboard
            const writeTextSpy = vi.fn().mockReturnValue(Promise.resolve());
            vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
                writeText: writeTextSpy,
            } as unknown as Clipboard);

            component.copyEventData();

            expect(writeTextSpy).toHaveBeenCalled();
            expect((component as any).snackBar.open).toHaveBeenCalledWith('Event data copied to clipboard', 'Close', expect.objectContaining({ duration: 3000 }));
        });
    });
});
