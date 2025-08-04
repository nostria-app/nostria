import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';

@Pipe({
  name: 'timestamp',
  standalone: true,
  pure: true,
})
export class TimestampPipe implements PipeTransform {
  private datePipe = new DatePipe('en-US');

  transform(value: number, format: string = 'medium'): string {
    if (value === 0) {
      return '';
    }

    // Convert Unix timestamp (seconds) to JavaScript timestamp (milliseconds)
    const date = new Date(value * 1000);

    // Use Angular's built-in DatePipe for formatting
    // Formats include: 'short', 'medium', 'long', 'full', 'shortDate', 'mediumDate', etc.
    return this.datePipe.transform(date, format) || '';
  }
}
