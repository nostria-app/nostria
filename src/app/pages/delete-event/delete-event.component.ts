import { Component, computed, inject, signal, OnInit } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { Event, nip19 } from 'nostr-tools';

import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { NostrService } from '../../services/nostr.service';
import { EventService } from '../../services/event';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-delete-event',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
],
  templateUrl: './delete-event.component.html',
  styleUrl: './delete-event.component.scss',
})
export class DeleteEventComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly accountState = inject(AccountStateService);
  private readonly dataService = inject(DataService);
  private readonly nostrService = inject(NostrService);
  private readonly eventService = inject(EventService);

  deleteForm: FormGroup;
  event = signal<Event | null>(null);
  isLoading = signal(false);

  eventDisplay = computed(() => {
    const event = this.event();
    if (!event) return null;

    return {
      id: event.id,
      kind: event.kind,
      content: event.content.slice(0, 100) + (event.content.length > 100 ? '...' : ''),
      createdAt: new Date(event.created_at * 1000).toLocaleString(),
      isOwn: event.pubkey === this.accountState.pubkey(),
    };
  });

  constructor() {
    this.deleteForm = this.fb.group({
      eventId: ['', [Validators.required, this.eventIdValidator]],
      reason: [''],
    });
  }

  ngOnInit() {
    // Check for pre-filled eventId from query parameters
    this.route.queryParams.subscribe(params => {
      if (params['eventId']) {
        this.deleteForm.patchValue({ eventId: params['eventId'] });
        // Automatically lookup the event
        setTimeout(() => this.lookupEvent(), 100);
      }
    });
  }

  private eventIdValidator(control: { value: string }) {
    const value = control.value;
    if (!value) return null;

    // Check if it's a valid hex event ID (64 characters)
    if (/^[a-f0-9]{64}$/i.test(value)) {
      return null;
    }

    // Check if it's a valid nevent
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === 'nevent') {
        return null;
      }
    } catch {
      // Invalid nevent
    }

    return { invalidEventId: true };
  }

  async lookupEvent() {
    if (!this.deleteForm.get('eventId')?.valid) {
      return;
    }

    this.isLoading.set(true);
    const eventId = this.deleteForm.get('eventId')?.value;
    let actualEventId = eventId;

    try {
      // If it's a nevent, extract the event ID
      if (eventId.startsWith('nevent')) {
        const decoded = nip19.decode(eventId);
        if (decoded.type === 'nevent') {
          actualEventId = decoded.data.id;
        }
      }

      // Try to find the event in local storage first
      const record = await this.dataService.getEventById(actualEventId);

      if (record && record.event) {
        this.event.set(record.event);
      } else {
        this.snackBar.open('Event not found in local storage', 'Dismiss', {
          duration: 3000,
        });
        this.event.set(null);
      }
    } catch (error) {
      console.error('Error looking up event:', error);
      this.snackBar.open('Error looking up event', 'Dismiss', {
        duration: 3000,
      });
      this.event.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteEvent() {
    const event = this.event();
    if (!event) {
      this.snackBar.open('No event selected for deletion', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    const display = this.eventDisplay();
    if (!display?.isOwn) {
      this.snackBar.open('You can only delete your own events', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    const reason = this.deleteForm.get('reason')?.value || '';

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Event',
        message: `Are you sure you want to request deletion of this event? This action creates a deletion request (NIP-09) but cannot guarantee the event will be removed from all relays and clients.`,
        confirmText: 'Delete Event',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    try {
      this.isLoading.set(true);
      const deleteEvent = this.nostrService.createRetractionEvent(event);

      // Add reason if provided
      if (reason.trim()) {
        deleteEvent.content = reason.trim();
      }

      const result = await this.nostrService.signAndPublish(deleteEvent);

      if (result.success) {
        // Delete from local database after successful deletion request
        await this.eventService.deleteEventFromLocalStorage(event.id);
        
        this.snackBar.open('Event deleted successfully', 'Dismiss', {
          duration: 5000,
        });

        // Reset form and event
        this.deleteForm.reset();
        this.event.set(null);
      } else {
        this.snackBar.open('Failed to publish deletion request', 'Dismiss', {
          duration: 3000,
        });
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      this.snackBar.open('Error publishing deletion request', 'Dismiss', {
        duration: 3000,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/settings/privacy']);
  }
}