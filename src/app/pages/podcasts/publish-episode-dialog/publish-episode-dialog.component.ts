import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { isValidHttpUrl, PODCAST_EPISODE_KIND } from '../../../utils/podcast';

@Component({
  selector: 'app-publish-episode-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <app-custom-dialog [title]="title" headerIcon="mic" (closed)="close(null)">
      <div dialog-content>
        <form [formGroup]="form">
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.publish.title">Episode title</mat-label>
            <input matInput formControlName="title" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.publish.audio">Audio URL</mat-label>
            <input matInput formControlName="audio" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.publish.image">Cover image URL</mat-label>
            <input matInput formControlName="image" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.publish.description">Description</mat-label>
            <textarea matInput formControlName="description" rows="3"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label i18n="@@podcasts.publish.notes">Show notes</mat-label>
            <textarea matInput formControlName="content" rows="6"></textarea>
          </mat-form-field>
        </form>
      </div>
      <div dialog-actions>
        <button mat-button (click)="close(null)" i18n="@@common.cancel">Cancel</button>
        <button mat-flat-button (click)="publish()" [disabled]="form.invalid || isSaving()">
          <span i18n="@@podcasts.publish.submit">Publish episode</span>
        </button>
      </div>
    </app-custom-dialog>
  `,
  styles: [`.full { width: 100%; }`],
})
export class PublishEpisodeDialogComponent {
  closed = output<{ published: boolean } | null>();

  private fb = inject(FormBuilder);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
  private snackBar = inject(MatSnackBar);

  readonly title = $localize`:@@podcasts.publish.dialogTitle:Publish episode`;
  readonly isSaving = signal(false);
  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    audio: ['', Validators.required],
    image: [''],
    description: [''],
    content: [''],
  });

  async publish(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open($localize`:@@podcasts.publish.signIn:Sign in to publish an episode`, '', { duration: 3000 });
      return;
    }

    const value = this.form.getRawValue();
    if (!isValidHttpUrl(value.audio)) {
      this.snackBar.open($localize`:@@podcasts.publish.invalidAudio:Enter a valid audio URL`, '', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);
    try {
      const tags: string[][] = [
        ['title', value.title.trim()],
        ['audio', value.audio.trim()],
      ];
      if (value.description.trim()) tags.push(['description', value.description.trim()]);
      if (value.image.trim() && isValidHttpUrl(value.image.trim())) tags.push(['image', value.image.trim()]);

      const signed = await this.nostr.signEvent({
        kind: PODCAST_EPISODE_KIND,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: value.content.trim(),
        tags,
      });
      await this.database.saveEvent(signed);
      this.podcastData.addEpisode(signed);
      await this.accountRelay.publish(signed);
      this.close({ published: true });
    } catch {
      this.snackBar.open($localize`:@@podcasts.publish.failed:Failed to publish episode`, '', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  close(result: { published: boolean } | null): void {
    this.closed.emit(result);
  }
}
