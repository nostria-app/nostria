import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
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
import { Router } from '@angular/router';
import { StorageService } from '../../../services/storage.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaService } from '../../../services/media.service';
import { Profile, ProfileData, ProfileUpdateOptions } from '../../../services/profile';
import { AccountRelayService } from '../../../services/relays/account-relay';

@Component({
  selector: 'app-profile-edit',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    AgoPipe,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss',
})
export class ProfileEditComponent implements OnInit {
  nostr = inject(NostrService);
  storage = inject(StorageService);
  data = inject(DataService);
  accountRelay = inject(AccountRelayService);
  router = inject(Router);
  media = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private profileService = inject(Profile);
  profile = signal<ProfileData | null>(null);
  pubkey = '';
  loading = signal<boolean>(false);
  accountState = inject(AccountStateService);

  // isOwnProfile = computed(() => {
  //   return this.accountState.pubkey() === this.pubkey();
  // });

  // Toggle states for profile image and banner
  useProfileImageUrl = signal<boolean>(false);
  useBannerUrl = signal<boolean>(false);

  // Preview states
  previewProfileImage = signal<string | null>(null);
  previewBanner = signal<string | null>(null);

  // Media server availability
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);

  constructor() {
    effect(() => {
      const account = this.accountState.account();

      // If the account changes while on edit screen, redirect to main profile page.
      if (account?.pubkey != this.pubkey) {
        this.router.navigate(['/p', this.pubkey], { replaceUrl: true });
      }
    });
  }

  ngOnInit() {
    const metadata = this.accountState.profile();

    // Keep a reference to the pubkey for the profile being edited, used for navigation and updates
    this.pubkey = this.accountState.pubkey();

    if (metadata?.data) {
      this.pubkey = metadata?.event.pubkey;

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
        nip05: '',
      });
    }
  }

  cancelEdit() {
    this.router.navigate(['/p', this.pubkey], { replaceUrl: true });
  }

  // Template-safe getters and setters for form fields
  get pictureUrl(): string {
    return (this.profile()?.['pictureUrl'] as string) || '';
  }

  set pictureUrl(value: string) {
    this.profile.update(p => ({ ...p, pictureUrl: value }));
  }

  get bannerUrl(): string {
    return (this.profile()?.['bannerUrl'] as string) || '';
  }

  set bannerUrl(value: string) {
    this.profile.update(p => ({ ...p, bannerUrl: value }));
  }

  get displayName(): string {
    return this.profile()?.display_name || '';
  }

  set displayName(value: string) {
    this.profile.update(p => ({ ...p, display_name: value }));
  }

  get name(): string {
    return this.profile()?.name || '';
  }

  set name(value: string) {
    this.profile.update(p => ({ ...p, name: value }));
  }

  get about(): string {
    return this.profile()?.about || '';
  }

  set about(value: string) {
    this.profile.update(p => ({ ...p, about: value }));
  }

  get website(): string {
    return this.profile()?.website || '';
  }

  set website(value: string) {
    this.profile.update(p => ({ ...p, website: value }));
  }

  get nip05(): string {
    return this.profile()?.nip05 || '';
  }

  set nip05(value: string) {
    this.profile.update(p => ({ ...p, nip05: value }));
  }

  get lud16(): string {
    return this.profile()?.lud16 || '';
  }

  set lud16(value: string) {
    this.profile.update(p => ({ ...p, lud16: value }));
  }

  async updateMetadata(): Promise<void> {
    if (!this.profile()) {
      this.snackBar.open('No profile to update', 'Close', { duration: 3000 });
      return;
    }

    this.loading.set(true);

    try {
      const currentProfile = this.profile()!;

      // Create cleaned profile data
      const profileData: ProfileData = {
        display_name: currentProfile.display_name || '',
        name: currentProfile.name || '',
        about: currentProfile.about || '',
        picture: currentProfile.picture || '',
        banner: currentProfile.banner || '',
        website: currentProfile.website || '',
        lud16: currentProfile.lud16 || '',
        nip05: currentProfile.nip05 || '',
      };

      // Create update options
      const updateOptions: ProfileUpdateOptions = {
        profileData,
      };

      // Add profile image file if selected
      if (currentProfile['selectedProfileFile']) {
        updateOptions.profileImageFile = currentProfile['selectedProfileFile'] as File;
      } else if (this.useProfileImageUrl() && currentProfile['pictureUrl']) {
        // If using URL, set it directly in profileData
        profileData.picture = currentProfile['pictureUrl'] as string;
      }

      // Add banner image file if selected
      if (currentProfile['selectedBannerFile']) {
        updateOptions.bannerImageFile = currentProfile['selectedBannerFile'] as File;
      } else if (this.useBannerUrl() && currentProfile['bannerUrl']) {
        // If using URL, set it directly in profileData
        profileData.banner = currentProfile['bannerUrl'] as string;
      }

      // Update the profile using the service
      const result = await this.profileService.updateProfile(updateOptions);

      if (result.success) {
        this.loading.set(false);
        this.router.navigate(['/p', this.accountState.pubkey()], {
          replaceUrl: true,
        });
      } else {
        throw new Error(result.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      this.snackBar.open(
        `Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Close',
        {
          duration: 5000,
        }
      );
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
        this.snackBar.open('Please select a valid image file', 'Close', {
          duration: 3000,
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = e => {
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
      const url = this.profile()?.['pictureUrl'] as string;
      if (url && url.trim() !== '') {
        this.previewProfileImage.set(url);
        // Don't update the main picture field here, let updateMetadata handle it
      } else {
        this.previewProfileImage.set(null);
      }
    } else {
      const url = this.profile()?.['bannerUrl'] as string;
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
          selectedProfileFile: null,
        }));
        if (currentUrl) {
          this.previewProfileImage.set(currentUrl);
        }
      } else {
        // Switching to file mode - clear file selection but keep URL for potential switch back
        this.profile.update(p => ({
          ...p,
          selectedProfileFile: null,
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
          selectedBannerFile: null,
        }));
        if (currentUrl) {
          this.previewBanner.set(currentUrl);
        }
      } else {
        // Switching to file mode - clear file selection but keep URL for potential switch back
        this.profile.update(p => ({
          ...p,
          selectedBannerFile: null,
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
