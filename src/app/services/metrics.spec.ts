import { TestBed } from '@angular/core/testing';

import { Metrics } from './metrics';

describe('Metrics', () => {
  let service: Metrics;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Metrics);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
