import { Component, computed, inject, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { CommonModule } from '@angular/common';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-date-toggle',
  imports: [TimestampPipe, CommonModule],
  providers: [AgoPipe],
  templateUrl: './date-toggle.component.html',
  styleUrl: './date-toggle.component.scss',
})
export class DateToggleComponent {
  private agoPipe = inject(AgoPipe);

  date = input<number>(0);
  omitAgoSuffix = input(false);
  showAgo = signal(true);

  formattedAgo = computed(() => {
    const value = this.date();
    const formatted = this.agoPipe.transform(value);

    if (!this.omitAgoSuffix()) {
      return formatted;
    }

    return formatted.replace(/\s+ago$/i, '');
  });

  onComponentClick(event: MouseEvent): void {
    this.showAgo.set(!this.showAgo());
  }
}
