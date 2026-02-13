import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';

@Component({
  selector: 'app-profile-open',
  template: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOpenComponent {
  private router = inject(Router);
  private accountState = inject(AccountStateService);

  constructor() {
    effect(() => {
      const profilePath = this.accountState.profilePath();

      if (profilePath) {
        this.router.navigateByUrl(profilePath, { replaceUrl: true });
      }
    });
  }
}
