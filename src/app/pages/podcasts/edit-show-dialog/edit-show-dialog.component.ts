import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import {
  getPodcastDescription,
  getPodcastImage,
  getPodcastTitle,
  getPodcastWebsites,
  isValidHttpUrl,
  PODCAST_METADATA_KIND,
} from '../../../utils/podcast';

@Component({
  selector: 'app-edit-show-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <app-custom-dialog [title]="title" headerIcon="podcasts" (closed)="close(null)">
      <div dialog-content>
        <form [formGroup]="form">
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.show.titleField">Show title</mat-label>
            <input matInput formControlName="title" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.show.image">Cover image URL</mat-label>
            <input matInput formControlName="image" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.show.website">Website</mat-label>
            <input matInput formControlName="website" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.show.description">Description</mat-label>
            <textarea matInput formControlName="description" rows="5"></textarea>
          </mat-form-field>
        </form>
      </div>
      <div dialog-actions>
        <button mat-button (click)="close(null)" i18n="@@common.cancel">Cancel</button>
        <button mat-flat-button (click)="publish()" [disabled]="form.invalid || isSaving()">
          <span i18n="@@podcasts.show.save">Save show</span>
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`.full { width: 100%; }`],
})
export class EditShowDialogComponent implements OnInit {
  closed = output<{ published: boolean } | null>();

  private fb = inject(FormBuilder);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
  private snackBar = inject(MatSnackBar);

  readonly title = $localize`:@@podcasts.show.dialogTitle:Show details`;
  readonly isSaving = signal(false);
  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    image: [''],
    website: [''],
    description: [''],
  });

  ngOnInit(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;
    const show = this.podcastData.getShow(pubkey);
    if (!show) return;
    this.form.patchValue({
      title: getPodcastTitle(show) || '',
      image: getPodcastImage(show) || '',
      website: getPodcastWebsites(show)[0] || '',
      description: getPodcastDescription(show) || '',
    });
  }

  async publish(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open($localize`:@@podcasts.show.signIn:Sign in to publish show details`, '', { duration: 3000 });
      return;
    }

    const value = this.form.getRawValue();
    this.isSaving.set(true);
    try {
      const tags: string[][] = [['title', value.title.trim()]];
      if (value.description.trim()) tags.push(['description', value.description.trim()]);
      if (value.image.trim() && isValidHttpUrl(value.image.trim())) tags.push(['image', value.image.trim()]);
      if (value.website.trim() && isValidHttpUrl(value.website.trim())) tags.push(['website', value.website.trim()]);

      const signed = await this.nostr.signEvent({
        kind: PODCAST_METADATA_KIND,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags,
      });
      await this.database.saveReplaceableEvent(signed);
      this.podcastData.addShow(signed);
      await this.accountRelay.publish(signed);
      this.close({ published: true });
    } catch {
      this.snackBar.open($localize`:@@podcasts.show.saveFailed:Failed to save show details`, '', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  close(result: { published: boolean } | null): void {
    this.closed.emit(result);
  }
}
