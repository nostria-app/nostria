import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { AccountStateService } from '../../../services/account-state.service';
import { ProfileOpenComponent } from './profile-open.component';

describe('ProfileOpenComponent', () => {
  let fixture: ComponentFixture<ProfileOpenComponent>;

  const mockRouter = {
    navigateByUrl: jasmine.createSpy('navigateByUrl'),
  };

  const mockAccountState = {
    profilePath: signal(''),
  };

  beforeEach(async () => {
    mockRouter.navigateByUrl.calls.reset();
    mockAccountState.profilePath.set('');

    await TestBed.configureTestingModule({
      imports: [ProfileOpenComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: Router, useValue: mockRouter },
        { provide: AccountStateService, useValue: mockAccountState },
      ],
    }).compileComponents();
  });

  it('should redirect to current profile path when available', () => {
    mockAccountState.profilePath.set('/p/npub1testprofile');

    fixture = TestBed.createComponent(ProfileOpenComponent);
    fixture.detectChanges();

    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/p/npub1testprofile', { replaceUrl: true });
  });

  it('should not redirect when profile path is empty', () => {
    fixture = TestBed.createComponent(ProfileOpenComponent);
    fixture.detectChanges();

    expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
  });
});
