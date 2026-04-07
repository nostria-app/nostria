import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatDialog } from '@angular/material/dialog';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { MediaPublishDialogComponent } from './media-publish-dialog.component';
import { MediaService } from '../../../services/media.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { ImagePlaceholderService } from '../../../services/image-placeholder.service';
import { LoggerService } from '../../../services/logger.service';
import { Router } from '@angular/router';

describe('MediaPublishDialogComponent', () => {
  let component: MediaPublishDialogComponent;
  let fixture: ComponentFixture<MediaPublishDialogComponent>;
  const dialogRefClose = vi.fn();
  const confirmationDialogOpen = vi.fn();

  beforeEach(async () => {
    dialogRefClose.mockReset();
    confirmationDialogOpen.mockReset();
    confirmationDialogOpen.mockReturnValue({
      afterClosed: () => ({
        subscribe: vi.fn(),
      }),
    });

    await TestBed.configureTestingModule({
      imports: [MediaPublishDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: dialogRefClose } },
        { provide: MatDialog, useValue: { open: confirmationDialogOpen } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            mediaItem: {
              sha256: 'sha',
              type: 'application/octet-stream',
              url: 'https://example.com/file.bin',
              size: 1024,
              uploaded: 1,
            },
          },
        },
        {
          provide: MediaService,
          useValue: {
            load: vi.fn().mockResolvedValue(undefined),
            mediaServers: vi.fn(() => ['https://media.example']),
          },
        },
        { provide: UtilitiesService, useValue: { extractThumbnailFromVideo: vi.fn() } },
        {
          provide: ImagePlaceholderService,
          useValue: {
            generatePlaceholders: vi.fn().mockResolvedValue({
              dimensions: { width: 100, height: 100 },
            }),
          },
        },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MediaPublishDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  async function setOwnedThumbnail(): Promise<void> {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumbnail');
    vi.spyOn(component as never as { loadImageAndGenerateBlurhash: (url: string) => Promise<void> }, 'loadImageAndGenerateBlurhash')
      .mockResolvedValue(undefined);

    const file = new File(['thumbnail'], 'thumb.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [file],
    });

    await component.onThumbnailFileSelected({ target: input } as unknown as Event);
  }

  it('revokes owned thumbnail blob URLs when removing the thumbnail', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await setOwnedThumbnail();

    component.removeThumbnail();

    expect(revokeSpy).toHaveBeenCalledWith('blob:thumbnail');
    expect(component.thumbnailUrl()).toBeUndefined();
  });

  it('revokes owned thumbnail blob URLs on destroy', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    await setOwnedThumbnail();

    component.ngOnDestroy();

    expect(revokeSpy).toHaveBeenCalledWith('blob:thumbnail');
  });

  it('warns instead of closing with media publish options when no media server is configured for kind 20', async () => {
    const mediaService = TestBed.inject(MediaService) as { mediaServers: ReturnType<typeof vi.fn> };
    mediaService.mediaServers.mockReturnValue([]);

    component.kind.set(20);

    await component.publish();

    expect(confirmationDialogOpen).toHaveBeenCalledTimes(1);
    expect(dialogRefClose).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 20 }));
  });
});
