import { inject, Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LocalSettingsService } from '../services/local-settings.service';
import { ChroniaCalendarService } from '../services/chronia-calendar.service';
import { EthiopianCalendarService } from '../services/ethiopian-calendar.service';

/**
 * A pipe that formats Unix timestamps as dates, respecting the user's calendar preference.
 * Works with Gregorian, Chronia, and Ethiopian calendar systems.
 */
@Pipe({
  name: 'chroniaDate',
  standalone: true,
  pure: false, // Not pure because it depends on settings signal
})
export class ChroniaDatePipe implements PipeTransform {
  private localSettings = inject(LocalSettingsService);
  private chroniaService = inject(ChroniaCalendarService);
  private ethiopianService = inject(EthiopianCalendarService);
  private datePipe = new DatePipe('en-US');

  /**
   * Transform a Unix timestamp (seconds) to a formatted date string.
   * Uses Gregorian, Chronia, or Ethiopian calendar based on user settings.
   *
   * @param value Unix timestamp in seconds
   * @param format Date format string. For Gregorian: Angular DatePipe formats.
   *               For Chronia/Ethiopian: 'short', 'medium', 'long', 'full', 'shortDate', 'mediumDate', etc.
   * @returns Formatted date string
   */
  transform(value: number, format = 'medium'): string {
    if (!value || value === 0) {
      return '';
    }

    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      return this.chroniaService.formatUnixTimestamp(value, format);
    }

    if (calendarType === 'ethiopian') {
      return this.ethiopianService.formatUnixTimestamp(value, format);
    }

    // Gregorian calendar - use Angular's DatePipe
    // Convert Unix timestamp (seconds) to JavaScript timestamp (milliseconds)
    const date = new Date(value * 1000);
    return this.datePipe.transform(date, format) || '';
  }
}
