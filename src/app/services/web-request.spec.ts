import { TestBed } from '@angular/core/testing';

import { WebRequest } from './web-request';

describe('WebRequest', () => {
  let service: WebRequest;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebRequest);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
