import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { CommunityService, Community, COMMUNITY_DEFINITION_KIND } from '../../../services/community.service';
import { NostrService } from '../../../services/nostr.service';
import { ApplicationService } from '../../../services/application.service';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';

type PostType = 'text' | 'media' | 'link';

interface UploadedFile {
  file: File;
  previewUrl: string;
  uploadedUrl: string | null;
  uploading: boolean;
  error: string | null;
}

@Component({
  selector: 'app-create-post',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatTabsModule,
    FormsModule,
    RouterLink,
  ],
  templateUrl: './create-post.component.html',
  styleUrls: ['./create-post.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatePostComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private nostrService = inject(NostrService);
  private app = inject(ApplicationService);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Edit event passed via router state — captured in constructor before Angular discards it */
  private routerStateEditEvent: NostrEvent | undefined;

  constructor() {
    const navigation = this.router.getCurrentNavigation();
    const stateEdit = navigation?.extras?.state?.['editEvent'] as NostrEvent | undefined;
    if (stateEdit) {
      this.routerStateEditEvent = stateEdit;
    }
  }

  /** The naddr parameter from the route */
  currentNaddr = signal('');

  /** The community we're posting to */
  community = signal<Community | null>(null);
  loading = signal(true);
  submitting = signal(false);

  /** Edit mode: the original event being edited */
  editEvent = signal<NostrEvent | null>(null);
  isEditMode = computed(() => this.editEvent() !== null);

  /** Post type tab */
  postType = signal<PostType>('text');
  selectedTabIndex = signal(0);

  /** Form fields */
  title = signal('');
  body = signal('');
  linkUrl = signal('');

  /** Media upload state */
  uploadedFiles = signal<UploadedFile[]>([]);
  isDragOver = signal(false);
  private dragCounter = 0;

  isAuthenticated = computed(() => this.app.authenticated());

  /** Whether the form can be submitted */
  canSubmit = computed(() => {
    const t = this.title().trim();
    if (!t) return false;
    if (this.submitting()) return false;

    // Edit mode: title is sufficient
    if (this.isEditMode()) return true;

    const type = this.postType();
    if (type === 'text') {
      return true; // Title is enough for text posts
    }
    if (type === 'media') {
      const files = this.uploadedFiles();
      // Need at least one file, and all must be finished uploading
      return files.length > 0 && files.every(f => f.uploadedUrl && !f.uploading);
    }
    if (type === 'link') {
      return this.linkUrl().trim().length > 0;
    }
    return false;
  });

  /** Map tab index to post type */
  private tabTypeMap: PostType[] = ['text', 'media', 'link'];

  ngOnInit(): void {
    const naddrParam = this.route.snapshot.paramMap.get('naddr');
    if (naddrParam) {
      this.currentNaddr.set(naddrParam);
      this.loadCommunity(naddrParam);
    } else {
      this.loading.set(false);
    }

    // Check for edit mode via router state
    const stateEditEvent = this.routerStateEditEvent
      ?? (this.isBrowser ? (history.state?.editEvent as NostrEvent | undefined) : undefined);

    if (stateEditEvent) {
      this.editEvent.set(stateEditEvent);
      // Pre-fill title from 'subject' tag
      const subject = stateEditEvent.tags.find((t: string[]) => t[0] === 'subject')?.[1];
      if (subject) {
        this.title.set(subject);
        this.body.set(stateEditEvent.content);
      } else {
        // No subject tag: first line is title, rest is body
        const lines = stateEditEvent.content.split('\n');
        this.title.set(lines[0] || '');
        this.body.set(lines.slice(1).join('\n').trim());
      }
    }
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    this.postType.set(this.tabTypeMap[index]);
  }

  /** File input handler */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFiles(Array.from(input.files));
    }
    // Reset so same file can be selected again
    input.value = '';
  }

  // Drag and drop handlers
  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    this.isDragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    this.dragCounter = 0;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFiles(Array.from(files));
    }
  }

  /** Remove an uploaded file */
  removeFile(index: number): void {
    this.uploadedFiles.update(files => {
      const updated = [...files];
      const removed = updated.splice(index, 1)[0];
      // Revoke object URL to free memory
      if (removed.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return updated;
    });
  }

  /** Submit the post (create new or save edit) */
  async submitPost(): Promise<void> {
    const comm = this.community();
    if (!comm || !this.canSubmit()) return;

    this.submitting.set(true);
    try {
      const titleVal = this.title().trim();
      const bodyVal = this.body().trim();

      // Edit mode: publish a kind 1010 edit event
      const original = this.editEvent();
      if (original) {
        // Build content: if there's a body, combine title + body for content,
        // but the title will be in the 'subject' tag
        const content = bodyVal;
        const tags: string[][] = [
          ['e', original.id],
          ['subject', titleVal],
        ];

        const unsignedEvent = this.nostrService.createEvent(1010, content, tags);
        const result = await this.nostrService.signAndPublish(unsignedEvent);

        if (result.success) {
          this.snackBar.open('Post updated!', 'Close', { duration: 3000 });
          this.router.navigate(['/n', this.currentNaddr()]);
        } else {
          this.snackBar.open(result.error || 'Failed to update post', 'Close', { duration: 5000 });
        }
        return;
      }

      // Create mode: publish a new community post
      const type = this.postType();
      let content = '';
      const urls: string[] = [];
      let link: string | undefined;

      if (type === 'text') {
        content = bodyVal;
      } else if (type === 'media') {
        content = bodyVal;
        for (const f of this.uploadedFiles()) {
          if (f.uploadedUrl) {
            urls.push(f.uploadedUrl);
          }
        }
      } else if (type === 'link') {
        content = bodyVal;
        link = this.linkUrl().trim();
      }

      const result = await this.communityService.publishCommunityPost(
        comm.coordinate,
        comm.creatorPubkey,
        content,
        {
          title: titleVal,
          urls: urls.length > 0 ? urls : undefined,
          link,
        },
      );

      if (result.success) {
        this.snackBar.open('Post published!', 'Close', { duration: 3000 });
        this.router.navigate(['/n', this.currentNaddr()]);
      } else {
        this.snackBar.open(result.error || 'Failed to publish post', 'Close', { duration: 5000 });
      }
    } catch (error) {
      this.logger.error('[CreatePost] Error publishing post:', error);
      this.snackBar.open('Failed to publish post', 'Close', { duration: 5000 });
    } finally {
      this.submitting.set(false);
    }
  }

  /** Navigate back to community */
  goBack(): void {
    this.router.navigate(['/n', this.currentNaddr()]);
  }

  private async loadCommunity(naddrStr: string): Promise<void> {
    this.loading.set(true);
    try {
      const decoded = nip19.decode(naddrStr);
      if (decoded.type !== 'naddr') {
        this.logger.error('[CreatePost] Invalid naddr:', naddrStr);
        this.loading.set(false);
        return;
      }

      const { pubkey, identifier, relays } = decoded.data;

      // Check router state first (passed from community page)
      const stateEvent = this.isBrowser
        ? (history.state?.communityEvent as NostrEvent | undefined)
        : undefined;

      if (stateEvent && stateEvent.pubkey === pubkey && stateEvent.kind === COMMUNITY_DEFINITION_KIND) {
        const dTag = stateEvent.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
        if (dTag === identifier) {
          this.community.set(this.communityService.parseCommunity(stateEvent));
          this.loading.set(false);
          return;
        }
      }

      // Fetch from relays
      const community = await this.communityService.fetchCommunity(pubkey, identifier, relays);
      if (community) {
        this.community.set(community);
      }
    } catch (error) {
      this.logger.error('[CreatePost] Error loading community:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async processFiles(files: File[]): Promise<void> {
    for (const file of files) {
      // Validate file type
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        this.snackBar.open('Please select image or video files', 'Close', { duration: 3000 });
        continue;
      }

      // Create preview URL
      const previewUrl = URL.createObjectURL(file);

      const entry: UploadedFile = {
        file,
        previewUrl,
        uploadedUrl: null,
        uploading: true,
        error: null,
      };

      // Add to list immediately for preview
      this.uploadedFiles.update(list => [...list, entry]);
      const currentIndex = this.uploadedFiles().length - 1;

      // Upload in background
      try {
        const servers = this.mediaService.mediaServers();
        const result = await this.mediaService.uploadFile(file, false, servers);

        if (result.item?.url) {
          this.uploadedFiles.update(list => {
            const updated = [...list];
            updated[currentIndex] = {
              ...updated[currentIndex],
              uploadedUrl: result.item!.url,
              uploading: false,
            };
            return updated;
          });
        } else {
          this.uploadedFiles.update(list => {
            const updated = [...list];
            updated[currentIndex] = {
              ...updated[currentIndex],
              uploading: false,
              error: result.message || 'Upload failed',
            };
            return updated;
          });
          this.snackBar.open(result.message || 'Upload failed', 'Close', { duration: 3000 });
        }
      } catch (error) {
        this.logger.error('[CreatePost] Upload error:', error);
        this.uploadedFiles.update(list => {
          const updated = [...list];
          if (updated[currentIndex]) {
            updated[currentIndex] = {
              ...updated[currentIndex],
              uploading: false,
              error: 'Upload failed',
            };
          }
          return updated;
        });
        this.snackBar.open('File upload failed', 'Close', { duration: 3000 });
      }
    }
  }
}
