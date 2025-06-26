import { TestBed } from '@angular/core/testing';

import { Username } from './username';

describe('Username', () => {
  let service: Username;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Username);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
