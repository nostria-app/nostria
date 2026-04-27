import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { MediaUploadDialogComponent } from './media-upload-dialog.component';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';

describe('MediaUploadDialogComponent', () => {
  let component: MediaUploadDialogComponent;
  let fixture: ComponentFixture<MediaUploadDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MediaUploadDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MediaService, useValue: { mediaServers: () => [] } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: CustomDialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MediaUploadDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('revokes video thumbnail blob URLs when a file is removed', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    component.selectedFiles.set([{
      id: 'video-1',
      file,
      previewUrl: null,
      isImage: false,
      isVideo: true,
      videoThumbnailUrl: 'blob:thumbnail',
    }]);

    component.removeFile(0);

    expect(revokeSpy).toHaveBeenCalledWith('blob:thumbnail');
    expect(component.selectedFiles()).toEqual([]);
  });

  it('revokes remaining video thumbnail blob URLs on destroy', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    component.selectedFiles.set([{
      id: 'video-1',
      file,
      previewUrl: null,
      isImage: false,
      isVideo: true,
      videoThumbnailUrl: 'blob:thumbnail',
    }]);

    component.ngOnDestroy();

    expect(revokeSpy).toHaveBeenCalledWith('blob:thumbnail');
  });
});
