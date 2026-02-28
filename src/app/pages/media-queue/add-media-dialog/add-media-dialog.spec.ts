/* eslint-disable @typescript-eslint/no-explicit-any */
import { AddMediaDialog, AddMediaDialogData } from './add-media-dialog';

function createComponent(data: Partial<AddMediaDialogData> = {}): AddMediaDialog {
    const component = Object.create(AddMediaDialog.prototype) as AddMediaDialog;

    (component as any).dialogRef = {
        close: vi.fn(),
    };

    (component as any).data = {
        url: data.url ?? '',
        playImmediately: data.playImmediately as boolean,
    } as AddMediaDialogData;

    return component;
}

describe('AddMediaDialog', () => {
    describe('constructor – playImmediately default', () => {
        it('should set playImmediately to true when undefined', () => {
            const component = createComponent({ url: 'https://example.com/video.mp4' });
            // Simulate the constructor logic
            component.constructor();

            expect(component.data.playImmediately).toBe(true);
        });

        it('should keep playImmediately false when explicitly set', () => {
            const component = createComponent({ url: 'https://example.com/video.mp4', playImmediately: false });
            component.constructor();

            expect(component.data.playImmediately).toBe(false);
        });

        it('should keep playImmediately true when explicitly set', () => {
            const component = createComponent({ url: 'https://example.com/audio.mp3', playImmediately: true });
            component.constructor();

            expect(component.data.playImmediately).toBe(true);
        });
    });

    describe('onNoClick', () => {
        it('should clear the url and close the dialog', () => {
            const component = createComponent({ url: 'https://example.com/video.mp4', playImmediately: true });

            component.onNoClick();

            expect(component.data.url).toBe('');
            expect((component as any).dialogRef.close).toHaveBeenCalledTimes(1);
            expect((component as any).dialogRef.close).toHaveBeenCalledWith();
        });

        it('should close dialog even when url is already empty', () => {
            const component = createComponent({ url: '', playImmediately: false });

            component.onNoClick();

            expect(component.data.url).toBe('');
            expect((component as any).dialogRef.close).toHaveBeenCalledTimes(1);
        });
    });
});
