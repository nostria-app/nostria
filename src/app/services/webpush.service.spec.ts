import { TestBed } from '@angular/core/testing';

import { WebPushService } from './webpush.service';

describe('WebpushService', () => {
  let service: WebPushService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebPushService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
