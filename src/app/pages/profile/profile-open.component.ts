import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-profile-open',
  template: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOpenComponent {
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);

  constructor() {
    effect(() => {
      const npub = this.accountState.npub();

      if (npub) {
        // Navigate to profile in right panel
        this.layout.openProfile(npub);
      }
    });
  }
}
