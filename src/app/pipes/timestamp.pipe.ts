import { inject, Pipe, PipeTransform } from '@angular/core';
import { LocalSettingsService } from '../services/local-settings.service';
import { ChroniaCalendarService } from '../services/chronia-calendar.service';
import { GregorianCalendarService } from '../services/gregorian-calendar.service';
import { EthiopianCalendarService } from '../services/ethiopian-calendar.service';

@Pipe({
  name: 'timestamp',
  standalone: true,
  pure: false, // Not pure because it depends on settings signal
})
export class TimestampPipe implements PipeTransform {
  private localSettings = inject(LocalSettingsService);
  private chroniaService = inject(ChroniaCalendarService);
  private gregorianService = inject(GregorianCalendarService);
  private ethiopianService = inject(EthiopianCalendarService);

  transform(value: number, format = 'medium'): string {
    if (value === 0) {
      return '';
    }

    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      return this.chroniaService.formatUnixTimestamp(value, format);
    }

    if (calendarType === 'ethiopian') {
      return this.ethiopianService.formatUnixTimestamp(value, format);
    }

    // Gregorian calendar - use localized month names
    const date = new Date(value * 1000);
    return this.formatGregorian(date, format);
  }

  /**
   * Format Gregorian date with localized month names
   */
  private formatGregorian(date: Date, format: string): string {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const monthName = this.gregorianService.getMonthName(month);
    const shortMonthName = this.gregorianService.getShortMonthName(month);
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    // Format time in 12-hour format
    const hour12 = hours % 12 || 12;
    const ampm = hours >= 12 ? 'PM' : 'AM';

    switch (format) {
      case 'short':
        return `${month}/${day}/${year % 100}, ${hour12}:${minutes} ${ampm}`;
      case 'shortDate':
        return `${month}/${day}/${year % 100}`;
      case 'medium':
        return `${monthName} ${day}, ${year}, ${hour12}:${minutes}:${seconds} ${ampm}`;
      case 'mediumDate':
        return `${monthName} ${day}, ${year}`;
      case 'long':
        return `${monthName} ${day}, ${year}, ${hour12}:${minutes}:${seconds} ${ampm}`;
      case 'longDate':
        return `${monthName} ${day}, ${year}`;
      case 'full':
        return `${monthName} ${day}, ${year}, ${hour12}:${minutes}:${seconds} ${ampm}`;
      case 'fullDate':
        return `${monthName} ${day}, ${year}`;
      default:
        return `${shortMonthName} ${day}, ${year}`;
    }
  }
}
