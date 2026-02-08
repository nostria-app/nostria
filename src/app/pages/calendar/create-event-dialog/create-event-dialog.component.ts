import { Component, inject, signal } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule } from '@angular/material/core';
import { Event, getEventHash } from 'nostr-tools';
import { ApplicationService } from '../../../services/application.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { LoggerService } from '../../../services/logger.service';

export interface CreateEventDialogData {
  selectedDate?: Date;
  isEdit?: boolean;
  event?: any;
}

export interface CreateEventResult {
  event: Event;
}

@Component({
  selector: 'app-create-event-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatCheckboxModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatNativeDateModule
],
  templateUrl: './create-event-dialog.component.html',
  styleUrl: './create-event-dialog.component.scss',
})
export class CreateEventDialogComponent {
  private dialogRef = inject(MatDialogRef<CreateEventDialogComponent>);
  private data = inject(MAT_DIALOG_DATA) as CreateEventDialogData;
  private fb = inject(FormBuilder);
  private app = inject(ApplicationService);
  private accountRelay = inject(AccountRelayService);
  private logger = inject(LoggerService);

  isLoading = signal<boolean>(false);
  isAllDay = signal<boolean>(false);

  eventForm: FormGroup;
  hashtags = signal<string[]>([]);

  constructor() {
    const selectedDate = this.data.selectedDate || new Date();
    const endDate = new Date(selectedDate);
    endDate.setHours(selectedDate.getHours() + 1);

    this.eventForm = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(200)]],
      summary: ['', Validators.maxLength(500)],
      content: ['', Validators.maxLength(2000)],
      startDate: [selectedDate, Validators.required],
      startTime: [selectedDate.toTimeString().slice(0, 5)],
      endDate: [endDate],
      endTime: [endDate.toTimeString().slice(0, 5)],
      location: ['', Validators.maxLength(300)],
      isAllDay: [false],
      hashtag: [''],
    });

    // Watch all-day toggle
    this.eventForm.get('isAllDay')?.valueChanges.subscribe(value => {
      this.isAllDay.set(value);
      if (value) {
        // For all-day events, clear time fields
        this.eventForm.get('startTime')?.setValue('00:00');
        this.eventForm.get('endTime')?.setValue('23:59');
      }
    });
  }

  addHashtag(): void {
    const hashtagControl = this.eventForm.get('hashtag');
    const hashtag = hashtagControl?.value?.trim().toLowerCase();

    if (hashtag && !this.hashtags().includes(hashtag)) {
      this.hashtags.update(tags => [...tags, hashtag]);
      hashtagControl?.setValue('');
    }
  }

  removeHashtag(hashtag: string): void {
    this.hashtags.update(tags => tags.filter(t => t !== hashtag));
  }

  onHashtagKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addHashtag();
    }
  }

  async create(): Promise<void> {
    if (!this.eventForm.valid || !this.app.accountState.pubkey()) {
      return;
    }

    this.isLoading.set(true);

    try {
      const formValue = this.eventForm.value;
      const isAllDay = formValue.isAllDay;

      let eventKind: 31922 | 31923;
      let tags: string[][];
      let startTimestamp: number;
      let endTimestamp: number | undefined;

      if (isAllDay) {
        // Date-based event (kind 31922)
        eventKind = 31922;
        const startDate = new Date(formValue.startDate);
        const endDate = formValue.endDate ? new Date(formValue.endDate) : undefined;

        // Format as YYYY-MM-DD
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate ? endDate.toISOString().split('T')[0] : undefined;

        tags = [
          ['d', this.generateRandomId()],
          ['title', formValue.title],
          ['start', startStr],
        ];

        if (endStr && endStr !== startStr) {
          tags.push(['end', endStr]);
        }
      } else {
        // Time-based event (kind 31923)
        eventKind = 31923;

        // Combine date and time
        const startDateTime = this.combineDateAndTime(formValue.startDate, formValue.startTime);
        const endDateTime =
          formValue.endDate && formValue.endTime
            ? this.combineDateAndTime(formValue.endDate, formValue.endTime)
            : undefined;

        startTimestamp = Math.floor(startDateTime.getTime() / 1000);
        endTimestamp = endDateTime ? Math.floor(endDateTime.getTime() / 1000) : undefined;

        tags = [
          ['d', this.generateRandomId()],
          ['title', formValue.title],
          ['start', startTimestamp.toString()],
        ];

        if (endTimestamp) {
          tags.push(['end', endTimestamp.toString()]);
        }
      }

      // Add optional fields
      if (formValue.summary?.trim()) {
        tags.push(['summary', formValue.summary.trim()]);
      }

      if (formValue.location?.trim()) {
        tags.push(['location', formValue.location.trim()]);
      }

      // Add hashtags
      this.hashtags().forEach(hashtag => {
        tags.push(['t', hashtag]);
      });

      // Create the event
      const eventToSign = {
        kind: eventKind,
        content: formValue.content || '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.app.accountState.pubkey()!,
      };

      // TODO: Sign the event with the user's private key
      // For now, we'll create a mock signed event
      const signedEvent: Event = {
        ...eventToSign,
        id: '', // This would be generated during signing
        sig: '', // This would be the signature
      };

      // Calculate the event ID (hash)
      signedEvent.id = getEventHash(signedEvent);

      // TODO: Get actual signature - this requires access to the user's private key
      // For now, we'll set a placeholder signature
      signedEvent.sig = 'placeholder_signature_' + Date.now();

      // Publish the event
      await this.accountRelay.publish(signedEvent);

      // Close dialog with the result
      this.dialogRef.close({ event: signedEvent } as CreateEventResult);
    } catch (error) {
      this.logger.error('Error creating calendar event:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private combineDateAndTime(date: Date, timeString: string): Date {
    const [hours, minutes] = timeString.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  private generateRandomId(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }
}
