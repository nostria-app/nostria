import { effect, inject, Injectable } from '@angular/core';
import { LayoutService } from './layout.service';
import { isNip05, queryProfile } from 'nostr-tools/nip05';

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  layout = inject(LayoutService);

  constructor() {
    effect(async () => {
      const query = this.layout.query();
      let searchValue = query;

      if (searchValue) {
        if (searchValue.indexOf('@') > -1) {

          if (!searchValue.startsWith('_')) {
            searchValue = '_' + searchValue;
          }

          if (isNip05(searchValue)) {
            const profile = await queryProfile(searchValue);
            console.log('Profile:', profile);

            if (profile?.pubkey) {
              this.layout.openProfile(profile?.pubkey);
              this.layout.toggleSearch();
            } else {
              this.layout.toast('Profile not found');
            }
          }
        }
      }
    });


  }
}
