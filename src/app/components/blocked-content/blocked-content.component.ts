import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { Event } from 'nostr-tools';
import { ReportingService } from '../../services/reporting.service';

@Component({
  selector: 'app-blocked-content',
  imports: [CommonModule, MatButtonModule, MatIconModule, MatCardModule],
  templateUrl: './blocked-content.component.html',
  styleUrl: './blocked-content.component.scss',
})
export class BlockedContentComponent {
  event = input.required<Event>();
  private reportingService = inject(ReportingService);

  showContent(): void {
    this.reportingService.toggleContentOverride(this.event().id);
  }

  isContentVisible(): boolean {
    return this.reportingService.isContentOverrideActive(this.event().id);
  }
}
