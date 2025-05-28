import { effect, inject, Injectable } from '@angular/core';
import { LayoutService } from './layout.service';
import { nip05 } from 'nostr-tools';

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

          if (nip05.isNip05(searchValue)) {
            const profile = await nip05.queryProfile(searchValue);
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
