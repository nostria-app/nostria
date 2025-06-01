import { TestBed } from '@angular/core/testing';

import { MediaPlayerService } from './media-player.service';

describe('MediaPlayerService', () => {
  let service: MediaPlayerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MediaPlayerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
