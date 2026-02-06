import { inject, Pipe, PipeTransform } from '@angular/core';
import { LocalSettingsService } from '../services/local-settings.service';
import { ChroniaCalendarService } from '../services/chronia-calendar.service';

@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  private localSettings = inject(LocalSettingsService);
  private chroniaService = inject(ChroniaCalendarService);

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || value === 0) {
      return '';
    }

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const timestamp = value;
    const diff = now - timestamp; // Difference in seconds

    if (diff < 0) {
      return 'in the future';
    }

    // Time intervals in seconds
    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
    const year = day * 365;

    // Return the appropriate time ago string
    switch (true) {
      case diff < 5:
        return 'just now';
      case diff < minute:
        return `${Math.floor(diff)} seconds ago`;
      case diff < minute * 2:
        return 'a minute ago';
      case diff < hour:
        return `${Math.floor(diff / minute)} minutes ago`;
      case diff < hour * 2:
        return 'an hour ago';
      case diff < day:
        return `${Math.floor(diff / hour)} hours ago`;
      case diff < day * 2:
        return 'yesterday';
      case diff < week:
        return `${Math.floor(diff / day)} days ago`;
      case diff < week * 2:
        return 'a week ago';
      case diff < month:
        return `${Math.floor(diff / week)} weeks ago`;
      case diff < month * 2:
        return 'a month ago';
      case diff < year:
        return `${Math.floor(diff / month)} months ago`;
      case diff < year * 2:
        return 'a year ago';
      default:
        return `${Math.floor(diff / year)} years ago`;
    }
  }
}
