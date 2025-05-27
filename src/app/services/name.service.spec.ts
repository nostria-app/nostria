import { TestBed } from '@angular/core/testing';

import { NameService } from './name.service';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

describe('NameService', () => {
  let service: NameService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideExperimentalZonelessChangeDetection()
      ]
    });
    service = TestBed.inject(NameService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

    it('validate reserved names', () => {
    expect(service.getReservedPaths().length).toBeGreaterThan(50);
    expect(service.isUsernameAvailable('admin')).toBeFalse();
    expect(service.isUsernameAvailable('api')).toBeFalse();
    expect(service.isUsernameAvailable('api_admin')).toBeFalse();
    expect(service.isUsernameAvailable('_nostria')).toBeFalse();
    expect(service.isUsernameAvailable('home')).toBeFalse();
    expect(service.isUsernameAvailable('__')).toBeFalse();
    expect(service.isUsernameAvailable('')).toBeFalse();
    expect(service.isUsernameAvailable('user  user')).toBeFalse();
    
    expect(service.isUsernameAvailable('user')).toBeTrue();
    expect(service.isUsernameAvailable('jackiechan')).toBeTrue();
    expect(service.isUsernameAvailable('JackieChan')).toBeTrue();
  });
});
