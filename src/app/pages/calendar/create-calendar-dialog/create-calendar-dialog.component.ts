import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Event } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ApplicationService } from '../../../services/application.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { LoggerService } from '../../../services/logger.service';

export interface CreateCalendarDialogData {
  isEdit?: boolean;
  calendar?: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: 31924;
    content: string;
    tags: string[][];
    title: string;
    events: string[];
  };
}

export interface CreateCalendarDialogResult {
  event: Event;
}

@Component({
  selector: 'app-create-calendar-dialog',
  imports: [
    CustomDialogComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './create-calendar-dialog.component.html',
  styleUrl: './create-calendar-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCalendarDialogComponent {
  data = input<CreateCalendarDialogData>({});
  closed = output<CreateCalendarDialogResult | null>();

  private fb = inject(FormBuilder);
  private app = inject(ApplicationService);
  private accountRelay = inject(AccountRelayService);
  private logger = inject(LoggerService);

  isLoading = signal(false);

  calendarForm: FormGroup = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', Validators.maxLength(500)],
  });

  constructor() {
    // Populate form when editing
    const d = this.data();
    if (d.isEdit && d.calendar) {
      this.calendarForm.patchValue({
        title: d.calendar.title,
        description: d.calendar.content || '',
      });
    }
  }

  get dialogTitle(): string {
    return this.data().isEdit ? 'Edit Calendar' : 'Create Calendar';
  }

  async save(): Promise<void> {
    if (!this.calendarForm.valid || !this.app.accountState.pubkey()) {
      return;
    }

    this.isLoading.set(true);

    try {
      const { title, description } = this.calendarForm.value;
      const existing = this.data().calendar;

      // Reuse the existing d-tag when editing, generate a new one for creation
      const dTag = existing ? this.getDTag(existing.tags) : this.generateId();

      // Preserve existing event references when editing
      const eventTags: string[][] = existing
        ? existing.tags.filter(t => t[0] === 'a')
        : [];

      const tags: string[][] = [
        ['d', dTag],
        ['title', title.trim()],
        ...eventTags,
      ];

      const eventToPublish = {
        kind: 31924 as const,
        content: description?.trim() || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.app.accountState.pubkey()!,
      };

      await this.accountRelay.publish(eventToPublish as unknown as Event);

      this.closed.emit({ event: eventToPublish as unknown as Event });
    } catch (error) {
      this.logger.error('Error saving calendar:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  private getDTag(tags: string[][]): string {
    return tags.find(t => t[0] === 'd')?.[1] ?? this.generateId();
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
