import { Component, inject, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EventPageComponent } from '../event.component';
import { Event } from 'nostr-tools';
import { Router, NavigationStart } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { CustomDialogRef } from '../../../services/custom-dialog.service';

export interface EventDialogData {
  eventId: string;
  event?: Event;
  // Optional: pubkey of a trusted user who shared this (for blur bypass on main event)
  trustedByPubkey?: string;
}

@Component({
  selector: 'app-event-dialog',
  imports: [
    MatButtonModule,
    MatIconModule,
    EventPageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div dialog-content class="event-dialog-content">
      <app-event-page 
        [dialogEventId]="data.eventId" 
        [dialogEvent]="data.event"
        [trustedByPubkey]="data.trustedByPubkey">
      </app-event-page>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class EventDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<EventDialogComponent>);
  data: EventDialogData = { eventId: '' };
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
