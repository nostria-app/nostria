import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';

interface CalendarEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 31922 | 31923;
  content: string;
  tags: string[][];
  title: string;
  summary?: string;
  image?: string;
  location?: string;
  start: Date;
  end?: Date;
  participants: string[];
  hashtags: string[];
  isAllDay: boolean;
  status?: 'accepted' | 'declined' | 'tentative';
}

export interface EventDetailsDialogData {
  event: CalendarEvent;
  canEdit: boolean;
  canDelete: boolean;
}

export interface EventDetailsResult {
  action: 'edit' | 'delete' | 'rsvp' | 'close';
  rsvpStatus?: 'accepted' | 'declined' | 'tentative';
}

@Component({
  selector: 'app-event-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatMenuModule,
    MatDividerModule
  ],
  template: `
    <div class="event-details-dialog">
      <div class="dialog-header">
        <div class="event-header-info">
          <h2>{{ data.event.title }}</h2>
          @if (data.event.summary) {
            <p class="event-subtitle">{{ data.event.summary }}</p>
          }
        </div>
        
        <div class="dialog-actions-header">
          <button mat-icon-button 
                  [matMenuTriggerFor]="actionsMenu"
                  matTooltip="Event actions">
            <mat-icon>more_vert</mat-icon>
          </button>
          
          <mat-menu #actionsMenu="matMenu">
            <button mat-menu-item (click)="respondToEvent('accepted')">
              <mat-icon color="primary">check_circle</mat-icon>
              <span>Accept</span>
            </button>
            <button mat-menu-item (click)="respondToEvent('tentative')">
              <mat-icon color="accent">help_outline</mat-icon>
              <span>Maybe</span>
            </button>
            <button mat-menu-item (click)="respondToEvent('declined')">
              <mat-icon color="warn">cancel</mat-icon>
              <span>Decline</span>
            </button>
            @if (data.canEdit || data.canDelete) {
              <mat-divider></mat-divider>
            }
            @if (data.canEdit) {
              <button mat-menu-item (click)="editEvent()">
                <mat-icon>edit</mat-icon>
                <span>Edit Event</span>
              </button>
            }
            @if (data.canDelete) {
              <button mat-menu-item (click)="deleteEvent()" class="delete-option">
                <mat-icon color="warn">delete</mat-icon>
                <span>Delete Event</span>
              </button>
            }
          </mat-menu>
          
          <button mat-icon-button 
                  [mat-dialog-close]="{ action: 'close' }"
                  matTooltip="Close">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <div class="dialog-content">
        <mat-card class="event-card">
          <!-- Event Time -->
          <div class="event-time-section">
            <mat-icon class="section-icon">schedule</mat-icon>
            <div class="time-details">
              @if (data.event.isAllDay) {
                <div class="time-info">
                  <strong>All day</strong>
                  <span class="date-info">{{ formatDate(data.event.start) }}</span>
                </div>
              } @else {
                <div class="time-info">
                  <strong>{{ formatTime(data.event.start) }}</strong>
                  @if (data.event.end) {
                    <span> - {{ formatTime(data.event.end) }}</span>
                  }
                  <span class="date-info">{{ formatDate(data.event.start) }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Event Location -->
          @if (data.event.location) {
            <div class="event-location-section">
              <mat-icon class="section-icon">location_on</mat-icon>
              <div class="location-details">
                <span>{{ data.event.location }}</span>
              </div>
            </div>
          }

          <!-- Event Description -->
          @if (data.event.content) {
            <div class="event-description-section">
              <mat-icon class="section-icon">description</mat-icon>
              <div class="description-content">
                <p>{{ data.event.content }}</p>
              </div>
            </div>
          }

          <!-- Event Tags -->
          @if (data.event.hashtags.length > 0) {
            <div class="event-tags-section">
              <mat-icon class="section-icon">tag</mat-icon>
              <div class="tags-content">
                <div class="tags-list">
                  @for (tag of data.event.hashtags; track tag) {
                    <mat-chip>{{ tag }}</mat-chip>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Participants -->
          @if (data.event.participants.length > 0) {
            <div class="event-participants-section">
              <mat-icon class="section-icon">people</mat-icon>
              <div class="participants-content">
                <span>{{ data.event.participants.length }} participant{{ data.event.participants.length !== 1 ? 's' : '' }}</span>
              </div>
            </div>
          }

          <!-- RSVP Status -->
          @if (data.event.status) {
            <div class="event-rsvp-section">
              <mat-icon class="section-icon">
                @switch (data.event.status) {
                  @case ('accepted') { check_circle }
                  @case ('declined') { cancel }
                  @case ('tentative') { help_outline }
                }
              </mat-icon>
              <div class="rsvp-content">
                <div class="rsvp-status" [class]="'status-' + data.event.status">
                  <span>{{ data.event.status | titlecase }}</span>
                </div>
              </div>
            </div>
          }
        </mat-card>
      </div>

      <div class="dialog-actions">
        <button mat-button 
                [mat-dialog-close]="{ action: 'close' }">
          Close
        </button>
        
        <div class="rsvp-actions">
          <button mat-stroked-button 
                  (click)="respondToEvent('declined')">
            <mat-icon>cancel</mat-icon>
            Decline
          </button>
          
          <button mat-stroked-button 
                  (click)="respondToEvent('tentative')">
            <mat-icon>help_outline</mat-icon>
            Maybe
          </button>
          
          <button mat-flat-button 
                  (click)="respondToEvent('accepted')">
            <mat-icon>check_circle</mat-icon>
            Accept
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrl: './event-details-dialog.component.scss'
})
export class EventDetailsDialogComponent {
  isLoading = signal(false);

  constructor(
    public dialogRef: MatDialogRef<EventDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: EventDetailsDialogData
  ) {}

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  respondToEvent(status: 'accepted' | 'declined' | 'tentative'): void {
    this.dialogRef.close({
      action: 'rsvp',
      rsvpStatus: status
    } as EventDetailsResult);
  }

  editEvent(): void {
    this.dialogRef.close({
      action: 'edit'
    } as EventDetailsResult);
  }

  deleteEvent(): void {
    this.dialogRef.close({
      action: 'delete'
    } as EventDetailsResult);
  }
}
