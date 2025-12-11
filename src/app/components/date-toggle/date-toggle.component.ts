import { Component, input, signal } from '@angular/core';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-date-toggle',
  imports: [AgoPipe, TimestampPipe, CommonModule],
  templateUrl: './date-toggle.component.html',
  styleUrl: './date-toggle.component.scss',
})
export class DateToggleComponent {
  date = input<number>(0);
  showAgo = signal(true);

  onComponentClick(event: MouseEvent): void {
    this.showAgo.set(!this.showAgo());
  }
}
