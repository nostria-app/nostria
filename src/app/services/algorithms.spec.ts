import { TestBed } from '@angular/core/testing';

import { Algorithms } from './algorithms';

describe('Algorithms', () => {
  let service: Algorithms;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Algorithms);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
