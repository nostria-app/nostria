import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { CreateMenuComponent } from './create-menu.component';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';

describe('CreateMenuComponent', () => {
    let component: CreateMenuComponent;
    let fixture: ComponentFixture<CreateMenuComponent>;

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
            imports: [CreateMenuComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: EventService, useValue: mockEventService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(CreateMenuComponent);
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

    it('should emit closed and call action on item click', () => {
        vi.spyOn(component.closed, 'emit');
        const option = component.createOptions[0]; // Note
        component.onItemClick(option);
        expect(component.closed.emit).toHaveBeenCalled();
        expect(mockEventService.createNote).toHaveBeenCalled();
    });

    it('should render primary options in the menu', async () => {
        await fixture.whenStable();
        const menuItems = (fixture.nativeElement as HTMLElement).querySelectorAll('.menu-item:not(.more-toggle)');
        expect(menuItems.length).toBe(4);
    });

    it('should render More... button', async () => {
        await fixture.whenStable();
        const moreButton = (fixture.nativeElement as HTMLElement).querySelector('.more-toggle');
        expect(moreButton).toBeTruthy();
        expect(moreButton!.textContent).toContain('More...');
    });

    it('should show more options when More... is clicked', async () => {
        await fixture.whenStable();
        component.toggleMore();
        fixture.detectChanges();
        await fixture.whenStable();

        const moreOptions = (fixture.nativeElement as HTMLElement).querySelectorAll('.more-options .menu-item');
        expect(moreOptions.length).toBe(5);
    });

    it('should call correct actions for more options', () => {
        component.onItemClick(component.moreOptions[0]); // List
        expect(mockLayoutService.createFollowSet).toHaveBeenCalled();

        component.onItemClick(component.moreOptions[1]); // Video Clip
        expect(mockLayoutService.openRecordVideoDialog).toHaveBeenCalled();

        component.onItemClick(component.moreOptions[2]); // Audio Clip
        expect(mockLayoutService.openRecordAudioDialog).toHaveBeenCalled();

        component.onItemClick(component.moreOptions[3]); // Music Track
        expect(mockLayoutService.openMusicUpload).toHaveBeenCalled();

        component.onItemClick(component.moreOptions[4]); // Live Stream
        expect(mockLayoutService.openLiveStreamDialog).toHaveBeenCalled();
    });
});
