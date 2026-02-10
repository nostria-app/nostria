import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { CreateMenuComponent } from './create-menu.component';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';

describe('CreateMenuComponent', () => {
  let component: CreateMenuComponent;
  let fixture: ComponentFixture<CreateMenuComponent>;

  const mockLayoutService = {
    createArticle: jasmine.createSpy('createArticle'),
    openMediaCreatorDialog: jasmine.createSpy('openMediaCreatorDialog'),
    openRecordVideoDialog: jasmine.createSpy('openRecordVideoDialog'),
    openRecordAudioDialog: jasmine.createSpy('openRecordAudioDialog'),
    openMessages: jasmine.createSpy('openMessages'),
    openLists: jasmine.createSpy('openLists'),
    openMusicUpload: jasmine.createSpy('openMusicUpload'),
    openLiveStreamDialog: jasmine.createSpy('openLiveStreamDialog'),
  };

  const mockEventService = {
    createNote: jasmine.createSpy('createNote'),
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

  it('should have 3 primary create options', () => {
    expect(component.createOptions.length).toBe(3);
  });

  it('should have Note, Article, and Media as primary options', () => {
    const labels = component.createOptions.map(o => o.label);
    expect(labels).toEqual(['Note', 'Article', 'Media']);
  });

  it('should have 6 more options', () => {
    expect(component.moreOptions.length).toBe(6);
  });

  it('should have Message, List, Video Clip, Audio Clip, Music Track, Live Stream as more options', () => {
    const labels = component.moreOptions.map(o => o.label);
    expect(labels).toEqual(['Message', 'List', 'Video Clip', 'Audio Clip', 'Music Track', 'Live Stream']);
  });

  it('should not show more options by default', () => {
    expect(component.showMore()).toBeFalse();
  });

  it('should toggle showMore when toggleMore is called', () => {
    component.toggleMore();
    expect(component.showMore()).toBeTrue();
    component.toggleMore();
    expect(component.showMore()).toBeFalse();
  });

  it('should emit closed and call action on item click', () => {
    spyOn(component.closed, 'emit');
    const option = component.createOptions[0]; // Note
    component.onItemClick(option);
    expect(component.closed.emit).toHaveBeenCalled();
    expect(mockEventService.createNote).toHaveBeenCalled();
  });

  it('should render primary options in the menu', async () => {
    await fixture.whenStable();
    const menuItems = (fixture.nativeElement as HTMLElement).querySelectorAll('.menu-item:not(.more-toggle)');
    expect(menuItems.length).toBe(3);
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
    expect(moreOptions.length).toBe(6);
  });

  it('should call correct actions for more options', () => {
    component.onItemClick(component.moreOptions[0]); // Message
    expect(mockLayoutService.openMessages).toHaveBeenCalled();

    component.onItemClick(component.moreOptions[1]); // List
    expect(mockLayoutService.openLists).toHaveBeenCalled();

    component.onItemClick(component.moreOptions[2]); // Video Clip
    expect(mockLayoutService.openRecordVideoDialog).toHaveBeenCalled();

    component.onItemClick(component.moreOptions[3]); // Audio Clip
    expect(mockLayoutService.openRecordAudioDialog).toHaveBeenCalled();

    component.onItemClick(component.moreOptions[4]); // Music Track
    expect(mockLayoutService.openMusicUpload).toHaveBeenCalled();

    component.onItemClick(component.moreOptions[5]); // Live Stream
    expect(mockLayoutService.openLiveStreamDialog).toHaveBeenCalled();
  });
});
