import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { NostrService } from '../../../services/nostr.service';
import { RelayService } from '../../../services/relay.service';
import { Router } from '@angular/router';
import { StorageService } from '../../../services/storage.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaService } from '../../../services/media.service';

@Component({
  selector: 'app-profile-edit',
  imports: [MatIconModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, FormsModule, AgoPipe, MatProgressSpinnerModule, MatSlideToggleModule],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss'
})
export class ProfileEditComponent {
  nostr = inject(NostrService);
  storage = inject(StorageService);
  data = inject(DataService);
  relay = inject(RelayService);
  router = inject(Router);
  media = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  profile = signal<any>(null);
  loading = signal<boolean>(false);
  accountState = inject(AccountStateService);

  // Toggle states for profile image and banner
  useProfileImageUrl = signal<boolean>(false);
  useBannerUrl = signal<boolean>(false);

  // Preview states
  previewProfileImage = signal<string | null>(null);
  previewBanner = signal<string | null>(null);

  // Media server availability
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);

  constructor() {

  }

  ngOnInit() {
    const metadata = this.accountState.profile();

    if (metadata?.data) {
      // User has existing profile data
      const profileClone = structuredClone(metadata.data);
      // Add URL fields for the toggles
      profileClone.pictureUrl = profileClone.picture || '';
      profileClone.bannerUrl = profileClone.banner || '';
      this.profile.set(profileClone);

      // Set initial toggle states based on existing URLs
      if (profileClone.picture) {
        this.useProfileImageUrl.set(true);
        this.previewProfileImage.set(profileClone.picture);
      }
      if (profileClone.banner) {
        this.useBannerUrl.set(true);
        this.previewBanner.set(profileClone.banner);
      }
    } else {
      // User has no profile, create a basic empty profile
      this.profile.set({
        display_name: '',
        name: '',
        about: '',
        picture: '',
        banner: '',
        pictureUrl: '',
        bannerUrl: '',
        website: '',
        lud16: '',
        nip05: ''
      });
    }
  }

  cancelEdit() {
    this.router.navigate(['/p', this.accountState.pubkey()], { replaceUrl: true });
  }

  async updateMetadata() {
    this.loading.set(true);

    try {
      // We want to be a good Nostr citizen and not delete custom metadata, except for certain deprecated fields.
      let profile = this.profile();

      // Remove deprecated fields NIP-24: https://github.com/nostr-protocol/nips/blob/master/24.md
      delete profile.displayName;
      delete profile.username;

      // Check if file uploads are needed
      const needsFileUpload = (!this.useProfileImageUrl() && profile.selectedProfileFile) ||
        (!this.useBannerUrl() && profile.selectedBannerFile);

      if (needsFileUpload && !this.hasMediaServers()) {
        this.snackBar.open('You need to configure media servers to upload images', 'Configure Now', {
          duration: 8000
        }).onAction().subscribe(() => {
          this.navigateToMediaSettings();
        });
        this.loading.set(false);
        return;
      }

      // Handle profile image upload or URL
      if (profile.selectedProfileFile && !this.useProfileImageUrl()) {
        const mediaServers = this.media.mediaServers();
        const uploadResult = await this.media.uploadFile(profile.selectedProfileFile, true, mediaServers);

        if (!uploadResult.item) {
          throw new Error(`Failed to upload profile image: ${uploadResult.message || 'Unknown error'}`);
        }

        profile.picture = uploadResult.item.url;
      } else if (this.useProfileImageUrl() && profile.pictureUrl) {
        profile.picture = profile.pictureUrl;
      }

      // Handle banner upload or URL
      if (profile.selectedBannerFile && !this.useBannerUrl()) {
        const mediaServers = this.media.mediaServers();
        const uploadResult = await this.media.uploadFile(profile.selectedBannerFile, true, mediaServers);

        if (!uploadResult.item) {
          throw new Error(`Failed to upload banner image: ${uploadResult.message || 'Unknown error'}`);
        }

        profile.banner = uploadResult.item.url;
      } else if (this.useBannerUrl() && profile.bannerUrl) {
        profile.banner = profile.bannerUrl;
      }

      // Clean up temporary file references
      delete profile.selectedProfileFile;
      delete profile.selectedBannerFile;
      delete profile.pictureUrl;
      delete profile.bannerUrl;

      // Check if user has existing profile
      const existingProfile = this.accountState.profile();
      const kind = existingProfile?.event.kind || 0; // Default to kind 0 for metadata
      const tags = existingProfile?.event.tags || []; // Default to empty tags array

      // If user enters a NIP-05 identifier for root without "_", we must prepend it with "_".
      if (profile.nip05 && !profile.nip05.startsWith('_')) {
        profile.nip05 = `_${profile.nip05}`;
      }

      const unsignedEvent = this.nostr.createEvent(kind, JSON.stringify(profile), tags);
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      await this.relay.publish(signedEvent);

      // Saving the event will parse the content back to JSON, the publish above might not be completed yet,
      // and will fail if we save. So we clone it and save it instead.

      // const clonedEvent = structuredClone(signedEvent);
      await this.storage.saveEvent(signedEvent);

      const record = this.data.getRecord(signedEvent);
      this.accountState.addToAccounts(record.event.pubkey, record);
      this.accountState.addToCache(record.event.pubkey, record);

      // Update the local account profile
      this.accountState.account()!.name = profile.display_name || profile.name || '';

      this.loading.set(false);

      this.router.navigate(['/p', this.accountState.pubkey()], { replaceUrl: true });
    } catch (error) {
      console.error('Error updating profile:', error);
      this.snackBar.open(`Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000
      });
      this.loading.set(false);
    }
  }

  // Handle file selection for profile image and banner
  onFileSelected(event: Event, type: 'profile' | 'banner'): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Simple file type validation
      if (!file.type.includes('image/')) {
        this.snackBar.open('Please select a valid image file', 'Close', { duration: 3000 });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;

        if (type === 'profile') {
          this.previewProfileImage.set(result);
          // Store the file for later upload
          this.profile.update(p => ({ ...p, selectedProfileFile: file }));
        } else {
          this.previewBanner.set(result);
          // Store the file for later upload
          this.profile.update(p => ({ ...p, selectedBannerFile: file }));
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // Handle URL input for images
  onImageUrlChange(type: 'profile' | 'banner'): void {
    if (type === 'profile') {
      const url = this.profile()?.pictureUrl;
      if (url && url.trim() !== '') {
        this.previewProfileImage.set(url);
        // Don't update the main picture field here, let updateMetadata handle it
      } else {
        this.previewProfileImage.set(null);
      }
    } else {
      const url = this.profile()?.bannerUrl;
      if (url && url.trim() !== '') {
        this.previewBanner.set(url);
        // Don't update the main banner field here, let updateMetadata handle it
      } else {
        this.previewBanner.set(null);
      }
    }
  }

  // Toggle image input method
  toggleImageInputMethod(type: 'profile' | 'banner'): void {
    if (type === 'profile') {
      const currentUrl = this.profile()?.picture || '';
      this.useProfileImageUrl.update(current => !current);

      if (this.useProfileImageUrl()) {
        // Switching to URL mode - preserve existing URL
        this.profile.update(p => ({
          ...p,
          pictureUrl: currentUrl,
          selectedProfileFile: null
        }));
        if (currentUrl) {
          this.previewProfileImage.set(currentUrl);
        }
      } else {
        // Switching to file mode - clear file selection but keep URL for potential switch back
        this.profile.update(p => ({
          ...p,
          selectedProfileFile: null
        }));
        this.previewProfileImage.set(currentUrl || null);
      }
    } else {
      const currentUrl = this.profile()?.banner || '';
      this.useBannerUrl.update(current => !current);

      if (this.useBannerUrl()) {
        // Switching to URL mode - preserve existing URL
        this.profile.update(p => ({
          ...p,
          bannerUrl: currentUrl,
          selectedBannerFile: null
        }));
        if (currentUrl) {
          this.previewBanner.set(currentUrl);
        }
      } else {
        // Switching to file mode - clear file selection but keep URL for potential switch back
        this.profile.update(p => ({
          ...p,
          selectedBannerFile: null
        }));
        this.previewBanner.set(currentUrl || null);
      }
    }
  }

  // Navigate to media settings
  navigateToMediaSettings(): void {
    this.router.navigate(['/media']);
  }
}
