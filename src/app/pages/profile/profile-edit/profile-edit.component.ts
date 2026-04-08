import { Component, inject, signal, computed, effect, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { NostrService } from '../../../services/nostr.service';
import { Router } from '@angular/router';
import { DatabaseService } from '../../../services/database.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, CdkDrag, CdkDropList, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaService } from '../../../services/media.service';
import { Profile, ProfileData, ProfileUpdateOptions } from '../../../services/profile';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { LoggerService } from '../../../services/logger.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { sanitizeProfileNameInput } from '../../../utils/profile-name';

interface ExternalIdentity {
  platform: string;
  identity: string;
  proof: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  templateUrl: './profile-edit.component.html',
  styleUrl: './profile-edit.component.scss',
})
export class ProfileEditComponent implements OnInit {
  nostr = inject(NostrService);
  database = inject(DatabaseService);
  data = inject(DataService);
  accountRelay = inject(AccountRelayService);
  router = inject(Router);
  media = inject(MediaService);
  private panelNav = inject(PanelNavigationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private readonly logger = inject(LoggerService);
  private profileService = inject(Profile);
  profile = signal<ProfileData | null>(null);
  pubkey = '';
  loading = signal<boolean>(false);
  accountState = inject(AccountStateService);

  // isOwnProfile = computed(() => {
  //   return this.accountState.pubkey() === this.pubkey();
  // });

  // Image input mode: 'upload' | 'url' | 'library'
  profileImageMode = signal<'upload' | 'url' | 'library'>('upload');
  bannerMode = signal<'upload' | 'url' | 'library'>('upload');

  // Preview states
  previewProfileImage = signal<string | null>(null);
  previewBanner = signal<string | null>(null);
  uploadOriginalImages = signal(false);
  nameWasNormalized = signal(false);

  // Media server availability
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);

  // External identities (NIP-39)
  externalIdentities = signal<ExternalIdentity[]>([]);
  newIdentityPlatform = signal<string>('');
  newIdentityValue = signal<string>('');
  newIdentityProof = signal<string>('');
  editingIdentityIndex = signal<number>(-1);
  refreshing = signal<boolean>(false);

  constructor() {
    effect(() => {
      const account = this.accountState.account();

      // If the account changes while on edit screen, navigate back.
      if (account?.pubkey != this.pubkey) {
        this.panelNav.goBackRight();
      }
    });
  }

  ngOnInit() {
    // Keep a reference to the pubkey for the profile being edited
    this.pubkey = this.accountState.pubkey();

    // Load cached profile immediately so the form isn't empty
    const cachedMetadata = this.accountState.profile();
    if (cachedMetadata?.data) {
      this.pubkey = cachedMetadata.event.pubkey;
      this.applyProfileData(cachedMetadata);
    } else {
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

    // Force-fetch the latest profile from relays to avoid editing stale data
    this.refreshProfileFromRelays();
  }

  private applyProfileData(metadata: { event: { pubkey: string; tags: string[][] }; data: ProfileData }) {
    const profileClone = structuredClone(metadata.data);
    if (typeof profileClone.name === 'string') {
      profileClone.name = sanitizeProfileNameInput(profileClone.name);
    }
    profileClone['pictureUrl'] = profileClone.picture || '';
    profileClone['bannerUrl'] = profileClone.banner || '';
    this.profile.set(profileClone);

    if (profileClone.picture) {
      this.previewProfileImage.set(profileClone.picture);
    } else {
      this.previewProfileImage.set(null);
    }
    if (profileClone.banner) {
      this.previewBanner.set(profileClone.banner);
    } else {
      this.previewBanner.set(null);
    }

    this.loadExternalIdentities(metadata.event.tags);
  }

  private async refreshProfileFromRelays() {
    if (!this.pubkey) return;

    this.refreshing.set(true);
    try {
      const freshProfile = await this.data.getProfile(this.pubkey, { forceRefresh: true });
      if (freshProfile?.data) {
        const cachedMetadata = this.accountState.profile();
        // Use the fresh profile if it's newer or if there's no cached version
        if (!cachedMetadata?.event || freshProfile.event.created_at >= cachedMetadata.event.created_at) {
          this.applyProfileData(freshProfile as { event: { pubkey: string; tags: string[][] }; data: ProfileData });
          // Also update accountState so the rest of the app has the latest profile
          this.accountState.profile.set(freshProfile);
          this.logger.info(`[ProfileEdit] Loaded fresh profile (created_at: ${freshProfile.event.created_at})`);
        }
      }
    } catch (error) {
      this.logger.warn('[ProfileEdit] Failed to refresh profile from relays:', error);
    } finally {
      this.refreshing.set(false);
    }
  }

  goBack(): void {
    this.panelNav.goBackRight();
  }

  cancelEdit() {
    this.panelNav.goBackRight();
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
    const sanitizedName = sanitizeProfileNameInput(value);
    this.nameWasNormalized.set(value !== sanitizedName);
    this.profile.update(p => ({ ...p, name: sanitizedName }));
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
        uploadOriginalImages: this.uploadOriginalImages(),
      };

      // Add profile image file if selected
      if (currentProfile['selectedProfileFile']) {
        updateOptions.profileImageFile = currentProfile['selectedProfileFile'] as File;
      } else if (this.profileImageMode() === 'url' && currentProfile['pictureUrl']) {
        // If using URL, set it directly in profileData
        profileData.picture = currentProfile['pictureUrl'] as string;
      }

      // Add banner image file if selected
      if (currentProfile['selectedBannerFile']) {
        updateOptions.bannerImageFile = currentProfile['selectedBannerFile'] as File;
      } else if (this.bannerMode() === 'url' && currentProfile['bannerUrl']) {
        // If using URL, set it directly in profileData
        profileData.banner = currentProfile['bannerUrl'] as string;
      }

      // Update the profile using the service
      const result = await this.profileService.updateProfile(updateOptions);

      if (result.success) {
        this.loading.set(false);
        this.panelNav.goBackRight();
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

      if (!this.hasMediaServers()) {
        this.snackBar.open('You need to configure a media server first', 'Configure', { duration: 5000 })
          .onAction().subscribe(() => this.navigateToMediaSettings());
        input.value = '';
        return;
      }

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
          this.profileImageMode.set('upload');
          // Store the file for later upload
          this.profile.update(p => ({ ...p, selectedProfileFile: file }));
        } else {
          this.previewBanner.set(result);
          this.bannerMode.set('upload');
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

  async openMediaChooser(type: 'profile' | 'banner'): Promise<void> {
    if (!this.hasMediaServers()) {
      this.snackBar.open('You need to configure a media server first', 'Configure', { duration: 5000 })
        .onAction().subscribe(() => this.navigateToMediaSettings());
      return;
    }

    const { MediaChooserDialogComponent } = await import('../../../components/media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../../../components/media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.dialog.open(MediaChooserDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'media-chooser-dialog-panel'],
      width: '700px',
      maxWidth: '95vw',
      data: {
        multiple: false,
        mediaType: 'images',
      },
    });

    dialogRef.afterClosed().subscribe((result: MediaChooserResult | undefined) => {
      const selected = result?.items?.[0];
      if (!selected) return;

      if (type === 'profile') {
        this.profileImageMode.set('upload');
        this.previewProfileImage.set(selected.url);
        this.profile.update(p => ({
          ...p,
          picture: selected.url,
          pictureUrl: selected.url,
          selectedProfileFile: null,
        }));
      } else {
        this.bannerMode.set('upload');
        this.previewBanner.set(selected.url);
        this.profile.update(p => ({
          ...p,
          banner: selected.url,
          bannerUrl: selected.url,
          selectedBannerFile: null,
        }));
      }
    });
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
