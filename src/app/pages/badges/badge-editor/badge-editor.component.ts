import { Component, inject, signal, computed, effect, untracked } from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { MediaService } from '../../../services/media.service';
import { LayoutService } from '../../../services/layout.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { BadgeService } from '../../../services/badge.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';

@Component({
  selector: 'app-badge-editor',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    FormsModule,
    MatSlideToggleModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './badge-editor.component.html',
  styleUrl: './badge-editor.component.scss',
})
export class BadgeEditorComponent {
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  nostr = inject(NostrService);
  accountRelay = inject(AccountRelayService);
  media = inject(MediaService);
  layout = inject(LayoutService);
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private badgeService = inject(BadgeService);
  private panelNav = inject(PanelNavigationService);

  // Determine if editing an existing badge
  isEditing = signal(false);

  // Form for badge creation
  badgeForm: FormGroup;

  // Tag management
  tagInput = signal('');
  tags = signal<string[]>([]);

  // Badge preview
  previewImage = signal<string | null>(null);
  previewThumbnail = signal<string | null>(null);

  // Toggle between upload and URL input
  useImageUrl = signal<boolean>(false);
  useThumbnailUrl = signal<boolean>(false);

  // Media server and upload status
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);
  isUploading = signal<boolean>(false);

  constructor() {
    this.badgeForm = this.fb.group({
      name: ['', [Validators.required]],
      slug: ['', [Validators.required]],
      description: ['', [Validators.required]],
      image: ['', [Validators.required]],
      thumbnail: [''],
      imageUrl: [''],
      thumbnailUrl: [''],
    });

    // Update slug automatically from name (only when creating new badges)
    this.badgeForm.get('name')?.valueChanges.subscribe(name => {
      const badgeId = this.route.snapshot.paramMap.get('id');
      // Don't auto-update slug when editing
      if (name && !badgeId) {
        const slug = name
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');
        this.badgeForm.get('slug')?.setValue(slug);
      }
    });

    // Load existing badge data if editing
    effect(() => {
      untracked(async () => {
        const badgeId = this.route.snapshot.paramMap.get('id');
        if (badgeId) {
          this.isEditing.set(true);
          await this.loadBadgeForEdit(badgeId);
        }
      });
    });
  }

  async loadBadgeForEdit(badgeId: string): Promise<void> {
    try {
      // Parse the badge id format: "kind:pubkey:slug"
      const parts = badgeId.split(':');
      if (parts.length < 3) {
        this.snackBar.open('Invalid badge ID format', 'Close', { duration: 3000 });
        return;
      }

      const [, pubkey, slug] = parts;

      // Load the badge definition
      const badgeDefinition = await this.badgeService.loadBadgeDefinition(pubkey, slug);

      if (!badgeDefinition) {
        this.snackBar.open('Badge not found', 'Close', { duration: 3000 });
        return;
      }

      // Parse badge data from tags
      const tags = badgeDefinition.tags || [];
      const name = tags.find(t => t[0] === 'name')?.[1] || '';
      const description = tags.find(t => t[0] === 'description')?.[1] || '';
      const image = tags.find(t => t[0] === 'image')?.[1] || '';
      const thumb = tags.find(t => t[0] === 'thumb')?.[1] || '';
      const tagValues = tags.filter(t => t[0] === 't').map(t => t[1]);

      // Populate the form
      this.badgeForm.patchValue({
        name,
        slug,
        description,
        image,
        thumbnail: thumb,
        imageUrl: image,
        thumbnailUrl: thumb,
      });

      // Set preview images
      if (image) {
        this.previewImage.set(image);
        this.useImageUrl.set(true);
      }
      if (thumb) {
        this.previewThumbnail.set(thumb);
        this.useThumbnailUrl.set(true);
      }

      // Set tags
      this.tags.set(tagValues);

    } catch (error) {
      console.error('Error loading badge for edit:', error);
      this.snackBar.open('Failed to load badge data', 'Close', { duration: 3000 });
    }
  }

  // Handle image upload for badge graphics
  onImageSelected(event: Event, type: 'image' | 'thumbnail'): void {
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

        if (type === 'image') {
          this.previewImage.set(result);
          this.badgeForm.get('image')?.setValue(file);
        } else {
          this.previewThumbnail.set(result);
          this.badgeForm.get('thumbnail')?.setValue(file);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // Handle URL input for images
  onImageUrlChange(type: 'image' | 'thumbnail'): void {
    const url =
      type === 'image'
        ? this.badgeForm.get('imageUrl')?.value
        : this.badgeForm.get('thumbnailUrl')?.value;

    if (url && url.trim() !== '') {
      // Update preview and form value
      if (type === 'image') {
        this.previewImage.set(url);
        this.badgeForm.get('image')?.setValue(url);
      } else {
        this.previewThumbnail.set(url);
        this.badgeForm.get('thumbnail')?.setValue(url);
      }
    } else {
      // Clear preview if URL is empty
      if (type === 'image') {
        this.previewImage.set(null);
        this.badgeForm.get('image')?.setValue('');
      } else {
        this.previewThumbnail.set(null);
        this.badgeForm.get('thumbnail')?.setValue('');
      }
    }
  }

  // Toggle image input method
  toggleImageInputMethod(type: 'image' | 'thumbnail'): void {
    if (type === 'image') {
      this.useImageUrl.update(current => !current);
      // Clear form values when switching
      this.badgeForm.get('image')?.setValue('');
      this.badgeForm.get('imageUrl')?.setValue('');
      this.previewImage.set(null);
    } else {
      this.useThumbnailUrl.update(current => !current);
      // Clear form values when switching
      this.badgeForm.get('thumbnail')?.setValue('');
      this.badgeForm.get('thumbnailUrl')?.setValue('');
      this.previewThumbnail.set(null);
    }
  }

  // Tag management
  addTag(event: Event): void {
    event.preventDefault();
    const value = this.tagInput().trim().toLowerCase();
    if (value !== '') {
      this.tags.update(currentTags => [...currentTags, value]);
      this.tagInput.set('');
    }
  }

  removeTag(tag: string): void {
    this.tags.update(currentTags => currentTags.filter(t => t !== tag));
  }

  // Navigate to media settings to add servers - specifically to the Media Servers tab
  navigateToMediaSettings(): void {
    this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
  }

  // Form submission with file upload handling
  async publishBadge(): Promise<void> {
    if (this.badgeForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.badgeForm.controls).forEach(key => {
        this.badgeForm.get(key)?.markAsTouched();
      });

      this.snackBar.open('Please fill all required fields', 'Close', {
        duration: 3000,
      });
      return;
    }

    const slug = this.badgeForm.get('slug')?.value;
    if (!slug) {
      throw new Error('Slug is required');
    }

    // Check if media servers are available when file uploads are needed
    const needsFileUpload =
      (!this.useImageUrl() && this.badgeForm.get('image')?.value instanceof File) ||
      (!this.useThumbnailUrl() && this.badgeForm.get('thumbnail')?.value instanceof File);

    if (needsFileUpload && !this.hasMediaServers()) {
      this.snackBar
        .open('You need to configure media servers to upload images', 'Configure Now', {
          duration: 8000,
        })
        .onAction()
        .subscribe(() => {
          this.navigateToMediaSettings();
        });
      return;
    }

    try {
      this.isUploading.set(true);

      let imageUrl: string;
      let thumbnailUrl: string | undefined;

      // Handle main image upload or URL
      if (this.useImageUrl()) {
        // Use provided URL
        imageUrl = this.badgeForm.get('imageUrl')?.value;
      } else {
        // Need to upload file
        const imageFile = this.badgeForm.get('image')?.value;
        if (imageFile instanceof File) {
          const mediaServers = this.media.mediaServers();
          const uploadResult = await this.media.uploadFile(imageFile, true, mediaServers);

          if (!uploadResult.item) {
            throw new Error(`Failed to upload image: ${uploadResult.message || 'Unknown error'}`);
          }

          imageUrl = uploadResult.item.url;
        } else {
          throw new Error('Image file is required');
        }
      }

      // Handle thumbnail upload or URL if provided
      if (this.badgeForm.get('thumbnail')?.value) {
        if (this.useThumbnailUrl()) {
          // Use provided thumbnail URL
          thumbnailUrl = this.badgeForm.get('thumbnailUrl')?.value;
        } else {
          // Need to upload thumbnail file
          const thumbnailFile = this.badgeForm.get('thumbnail')?.value;
          if (thumbnailFile instanceof File) {
            const mediaServers = this.media.mediaServers();
            const uploadResult = await this.media.uploadFile(thumbnailFile, true, mediaServers);

            if (!uploadResult.item) {
              throw new Error(
                `Failed to upload thumbnail: ${uploadResult.message || 'Unknown error'}`
              );
            }

            thumbnailUrl = uploadResult.item.url;
          }
        }
      }

      // Create tags for the badge definition
      const tags: string[][] = [];

      tags.push(['d', slug]);
      tags.push(['name', this.badgeForm.get('name')?.value]);
      tags.push(['description', this.badgeForm.get('description')?.value]);

      tags.push(['image', imageUrl, '1024x1024']);

      if (thumbnailUrl) {
        tags.push(['thumb', thumbnailUrl, '256x256']);
      }

      for (const tag of this.tags()) {
        tags.push(['t', tag]);
      }

      const definitionEvent = this.nostr.createEvent(kinds.BadgeDefinition, '', tags);
      console.log('Badge definition event:', definitionEvent);

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(definitionEvent);
      const publishResult = await this.accountRelay.publish(signedEvent);

      await this.layout.showPublishResults(publishResult, 'Badge');

// Navigate back to user's badges page
      const pubkey = this.accountState.pubkey();
      const npub = this.utilities.getNpubFromPubkey(pubkey);
      this.layout.openBadgesPage(npub || pubkey);
    } catch (error) {
      console.error('Error publishing badge:', error);
      this.snackBar.open(
        `Failed to publish badge: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Close',
        {
          duration: 5000,
        }
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  // Navigation
  cancel(): void {
    // Use panel navigation to go back in the right panel history
    this.panelNav.goBackRight();
  }
}
