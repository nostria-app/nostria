import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { NostrService } from '../../../services/nostr.service';
import { NostrEvent } from 'nostr-tools';
import { RelayService } from '../../../services/relay.service';
import { Router } from '@angular/router';
import { StorageService } from '../../../services/storage.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../../services/data.service';
import { NostrRecord } from '../../../interfaces';

@Component({
  selector: 'app-profile-edit',
  imports: [MatIconModule, MatButtonModule, CommonModule, MatCardModule, MatFormFieldModule, MatInputModule, FormsModule, AgoPipe, MatProgressSpinnerModule],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss'
})
export class ProfileEditComponent {
  nostr = inject(NostrService);
  storage = inject(StorageService);
  data = inject(DataService);
  relay = inject(RelayService);
  router = inject(Router);
  profile = signal<any>(null);
  metadata = signal<NostrRecord | undefined>(undefined);
  loading = signal<boolean>(false);

  constructor() {

  }

  ngOnInit() {
    const metadata = this.nostr.getMetadataForAccount(this.nostr.pubkey());
    this.metadata.set(metadata);
    const profileClone = structuredClone(metadata?.data);
    this.profile.set(profileClone);
  }

  cancelEdit() { 
    this.router.navigate(['/p', this.nostr.pubkey()], { replaceUrl: true });
  }

  async updateMetadata() {
    this.loading.set(true);
    // We want to be a good Nostr citizen and not delete custom metadata, except for certain deprecated fields.
    let profile = this.profile();

    // Remove deprecated fields NIP-24: https://github.com/nostr-protocol/nips/blob/master/24.md
    delete profile.displayName;
    delete profile.username;

    // this.metadata()!.content = JSON.stringify(profile);

    const unsignedEvent = this.nostr.createEvent(this.metadata()!.event.kind, JSON.stringify(profile), this.metadata()!.event.tags);
    const signedEvent = await this.nostr.signEvent(unsignedEvent);

    await this.relay.publish(signedEvent);

    // Saving the event will parse the content back to JSON, the publish above might not be completed yet,
    // and will fail if we save. So we clone it and save it instead.

    // const clonedEvent = structuredClone(signedEvent);
    await this.storage.saveEvent(signedEvent);

    const record = this.data.getRecord(signedEvent);
    this.nostr.updateAccountMetadata(record);

    // Update the local account profile
    this.nostr.account()!.name = profile.display_name;

    this.loading.set(false);

    this.router.navigate(['/p', this.nostr.pubkey()], { replaceUrl: true });
  }

  onProfileFileSelected(event: any): void {
    if (!this.profile()) {
      return;
    }

    // this.selectedProfileFile = event.target.files[0] ?? null;
    // const url = (window.URL ? URL : webkitURL).createObjectURL(this.selectedProfileFile);
    // this.profile.picture = this.sanitizer.bypassSecurityTrustUrl(url);
  }

  onBannerFileSelected(event: any): void {
    if (!this.profile()) {
      return;
    }

    // this.selectedBannerFile = event.target.files[0] ?? null;
    // const url = (window.URL ? URL : webkitURL).createObjectURL(this.selectedBannerFile);
    // this.profile.banner = this.sanitizer.bypassSecurityTrustUrl(url);
  }
}
