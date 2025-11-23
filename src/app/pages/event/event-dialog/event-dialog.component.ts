import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EventPageComponent } from '../event.component';
import { Event } from 'nostr-tools';
import { Router, NavigationStart } from '@angular/router';
import { Subscription, filter } from 'rxjs';

export interface EventDialogData {
  eventId: string;
  event?: Event;
}

@Component({
  selector: 'app-event-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    EventPageComponent,
  ],
  template: `
    <div class="event-dialog-header">
      <h2 class="dialog-title">Thread</h2>
      <button mat-icon-button (click)="close()" class="close-button">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <div class="event-dialog-content">
      <app-event-page 
        [dialogEventId]="data.eventId" 
        [dialogEvent]="data.event">
      </app-event-page>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .event-dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 8px 8px 16px;
      position: sticky;
      top: 0;
      background: var(--mat-sys-surface);
      z-index: 10;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .dialog-title {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 400;
    }

    .close-button {
      color: var(--mat-sys-on-surface);
    }

    .event-dialog-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 16px 16px;
    }
  `],
})
export class EventDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject(MatDialogRef<EventDialogComponent>);
  data = inject<EventDialogData>(MAT_DIALOG_DATA);
  private router = inject(Router);
  private routerSubscription?: Subscription;

  ngOnInit(): void {
    // Subscribe to router navigation events
    // When a navigation starts, close the dialog
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationStart))
      .subscribe(() => {
        this.close();
      });
  }

  ngOnDestroy(): void {
    // Clean up subscription when component is destroyed
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
