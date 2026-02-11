import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
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
import { DatabaseService } from '../../../services/database.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaService } from '../../../services/media.service';
import { Profile, ProfileData, ProfileUpdateOptions } from '../../../services/profile';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { LoggerService } from '../../../services/logger.service';

interface ExternalIdentity {
  platform: string;
  identity: string;
  proof: string;
}

@Component({
  selector: 'app-profile-edit',
  host: { 'class': 'panel-with-sticky-header' },
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
    MatMenuModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss',
})
export class ProfileEditComponent implements OnInit, OnDestroy {
  nostr = inject(NostrService);
  database = inject(DatabaseService);
  data = inject(DataService);
  accountRelay = inject(AccountRelayService);
  router = inject(Router);
  media = inject(MediaService);
  private location = inject(Location);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
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

  // External identities (NIP-39)
  externalIdentities = signal<ExternalIdentity[]>([]);
  newIdentityPlatform = signal<string>('');
  newIdentityValue = signal<string>('');
  newIdentityProof = signal<string>('');
  editingIdentityIndex = signal<number>(-1);

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

      // Load external identities from existing metadata tags
      this.loadExternalIdentities(metadata.event.tags);
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

  ngOnDestroy() {
    // Note: Profile component will handle setting the title back to "Profile"
    // via its router events subscription when navigating away from edit
  }

  goBack(): void {
    this.location.back();
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

  get newIdentityPlatformValue(): string {
    return this.newIdentityPlatform();
  }

  set newIdentityPlatformValue(value: string) {
    this.newIdentityPlatform.set(value);
  }

  get newIdentityValueValue(): string {
    return this.newIdentityValue();
  }

  set newIdentityValueValue(value: string) {
    this.newIdentityValue.set(value);
  }

  get newIdentityProofValue(): string {
    return this.newIdentityProof();
  }

  set newIdentityProofValue(value: string) {
    this.newIdentityProof.set(value);
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
        externalIdentities: this.externalIdentities(),
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
      this.logger.error('Error updating profile:', error);
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

  // Navigate to media settings - specifically to the Media Servers tab
  navigateToMediaSettings(): void {
    this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
  }

  removeImage(type: 'profile' | 'banner'): void {
    if (type === 'profile') {
      this.previewProfileImage.set(null);
      this.profile.update(p => ({
        ...p,
        picture: '',
        pictureUrl: '',
        selectedProfileFile: null,
      }));
      // Reset file input if it exists
      const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } else {
      this.previewBanner.set(null);
      this.profile.update(p => ({
        ...p,
        banner: '',
        bannerUrl: '',
        selectedBannerFile: null,
      }));
      // Reset file input if it exists
      const fileInput = document.querySelectorAll('input[type="file"][accept="image/*"]')[1] as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
  }

  // External identities methods
  loadExternalIdentities(tags: string[][]): void {
    if (!tags) return;

    const identities: ExternalIdentity[] = [];
    const iTags = tags.filter(tag => tag[0] === 'i' && tag.length >= 2);

    for (const tag of iTags) {
      const platformIdentity = tag[1];
      const proof = tag[2] || '';

      const separatorIndex = platformIdentity.indexOf(':');
      if (separatorIndex === -1) continue;

      const platform = platformIdentity.substring(0, separatorIndex);
      const identity = platformIdentity.substring(separatorIndex + 1);

      identities.push({ platform, identity, proof });
    }

    this.externalIdentities.set(identities);
  }

  addExternalIdentity(): void {
    const platform = this.newIdentityPlatform().trim();
    const identity = this.newIdentityValue().trim();
    const proof = this.newIdentityProof().trim();

    if (!platform || !identity) {
      this.snackBar.open('Platform and identity are required', 'Close', { duration: 3000 });
      return;
    }

    // Validate platform name (only a-z, 0-9, and ._-/)
    if (!/^[a-z0-9._\-/]+$/.test(platform)) {
      this.snackBar.open('Platform name should only contain lowercase letters, numbers, and ._-/', 'Close', {
        duration: 3000,
      });
      return;
    }

    const editIndex = this.editingIdentityIndex();

    if (editIndex >= 0) {
      // Update existing identity
      this.externalIdentities.update(identities => {
        const updated = [...identities];
        updated[editIndex] = { platform, identity, proof };
        return updated;
      });
      this.editingIdentityIndex.set(-1);
    } else {
      // Check for duplicates only when adding new
      const exists = this.externalIdentities().some(id => id.platform === platform && id.identity === identity);
      if (exists) {
        this.snackBar.open('This identity already exists', 'Close', { duration: 3000 });
        return;
      }

      // Add new identity
      this.externalIdentities.update(identities => [...identities, { platform, identity, proof }]);
    }

    // Reset form
    this.newIdentityPlatform.set('');
    this.newIdentityValue.set('');
    this.newIdentityProof.set('');
  }

  dropIdentity(event: CdkDragDrop<ExternalIdentity[]>): void {
    const items = [...this.externalIdentities()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.externalIdentities.set(items);
  }

  removeExternalIdentity(index: number): void {
    this.externalIdentities.update(identities => identities.filter((_, i) => i !== index));
    // If we're editing this identity, cancel the edit
    if (this.editingIdentityIndex() === index) {
      this.cancelEditIdentity();
    }
  }

  editExternalIdentity(index: number): void {
    const identity = this.externalIdentities()[index];
    this.newIdentityPlatform.set(identity.platform);
    this.newIdentityValue.set(identity.identity);
    this.newIdentityProof.set(identity.proof);
    this.editingIdentityIndex.set(index);
  }

  cancelEditIdentity(): void {
    this.newIdentityPlatform.set('');
    this.newIdentityValue.set('');
    this.newIdentityProof.set('');
    this.editingIdentityIndex.set(-1);
  }

  selectPlatformPreset(platform: string): void {
    this.newIdentityPlatform.set(platform);
  }
}
