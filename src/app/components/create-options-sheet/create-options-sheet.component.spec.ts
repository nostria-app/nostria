import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { CreateOptionsSheetComponent } from './create-options-sheet.component';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';

describe('CreateOptionsSheetComponent', () => {
    let component: CreateOptionsSheetComponent;
    let fixture: ComponentFixture<CreateOptionsSheetComponent>;

    const mockBottomSheetRef = {
        dismiss: vi.fn(),
    };

    const mockLayoutService = {
        createArticle: vi.fn(),
        openMediaCreatorDialog: vi.fn(),
        openRecordVideoDialog: vi.fn(),
        openRecordAudioDialog: vi.fn(),
        openMessages: vi.fn(),
        createFollowSet: vi.fn(),
        openMusicUpload: vi.fn(),
        openLiveStreamDialog: vi.fn(),
    };

    const mockEventService = {
        createNote: vi.fn(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [CreateOptionsSheetComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: MatBottomSheetRef, useValue: mockBottomSheetRef },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: EventService, useValue: mockEventService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(CreateOptionsSheetComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have 4 primary create options', () => {
        expect(component.createOptions.length).toBe(4);
    });

    it('should have Note, Article, Media, and Message as primary options', () => {
        const labels = component.createOptions.map(o => o.label);
        expect(labels).toEqual(['Note', 'Article', 'Media', 'Message']);
    });

    it('should have 5 more options', () => {
        expect(component.moreOptions.length).toBe(5);
    });

    it('should have List, Video Clip, Audio Clip, Music Track, Live Stream as more options', () => {
        const labels = component.moreOptions.map(o => o.label);
        expect(labels).toEqual(['List', 'Video Clip', 'Audio Clip', 'Music Track', 'Live Stream']);
    });

    it('should not show more options by default', () => {
        expect(component.showMore()).toBe(false);
    });

    it('should toggle showMore when toggleMore is called', () => {
        component.toggleMore();
        expect(component.showMore()).toBe(true);
        component.toggleMore();
        expect(component.showMore()).toBe(false);
    });

    it('should dismiss bottom sheet and call action on selectOption', () => {
        const action = vi.fn();
        component.selectOption(action);
        expect(mockBottomSheetRef.dismiss).toHaveBeenCalled();
        expect(action).toHaveBeenCalled();
    });

    it('should render primary options in the list', async () => {
        await fixture.whenStable();
        const listItems = (fixture.nativeElement as HTMLElement).querySelectorAll('a[mat-list-item]:not(.more-toggle)');
        expect(listItems.length).toBe(4);
    });

    it('should render More... toggle', async () => {
        await fixture.whenStable();
        const moreToggle = (fixture.nativeElement as HTMLElement).querySelector('.more-toggle');
        expect(moreToggle).toBeTruthy();
        expect(moreToggle!.textContent).toContain('More...');
    });

    it('should show more options when toggled', async () => {
        await fixture.whenStable();
        component.toggleMore();
        fixture.detectChanges();
        await fixture.whenStable();

        const allItems = (fixture.nativeElement as HTMLElement).querySelectorAll('a[mat-list-item]:not(.more-toggle)');
        // 4 primary + 5 more = 9
        expect(allItems.length).toBe(9);
    });

    it('should call correct actions for more options', () => {
        const listOption = component.moreOptions[0];
        component.selectOption(listOption.action);
        expect(mockLayoutService.createFollowSet).toHaveBeenCalled();

        const videoOption = component.moreOptions[1];
        component.selectOption(videoOption.action);
        expect(mockLayoutService.openRecordVideoDialog).toHaveBeenCalled();

        const audioOption = component.moreOptions[2];
        component.selectOption(audioOption.action);
        expect(mockLayoutService.openRecordAudioDialog).toHaveBeenCalled();

        const musicOption = component.moreOptions[3];
        component.selectOption(musicOption.action);
        expect(mockLayoutService.openMusicUpload).toHaveBeenCalled();

        const liveStreamOption = component.moreOptions[4];
        component.selectOption(liveStreamOption.action);
        expect(mockLayoutService.openLiveStreamDialog).toHaveBeenCalled();
    });
});
