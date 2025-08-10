import { TestBed } from '@angular/core/testing';

import { Followset } from './followset';

describe('Followset', () => {
  let service: Followset;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Followset);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
