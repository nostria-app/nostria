import { Injectable } from '@angular/core';

export interface ChroniaDate {
  year: number;
  month: number; // 1-13 (0 for special days)
  day: number; // 1-28 (or 0 for Solstice Day/Leap Day)
  isLeapDay: boolean;
  isSolsticeDay: boolean;
}

export interface ChroniaDateTime extends ChroniaDate {
  hour: number;
  minute: number;
  second: number;
}

/**
 * Chronia Calendar Service
 *
 * The Chronia Calendar is a modern, simplified, scientifically structured calendar system.
 *
 * Structure:
 * - 13 months of 28 days each = 364 structured days
 * - Solstice Day: Occurs at the end of every year (after month 13)
 * - Leap Day: Occurs in leap years, placed before Solstice Day
 *
 * Conversion anchor:
 * - Chronia 00.01.01 = 22 December 2015 (Gregorian)
 *
 * Leap year rule (same as Gregorian):
 * - Divisible by 4: leap year
 * - Except divisible by 100: not a leap year
 * - Except divisible by 400: leap year
 */
@Injectable({
  providedIn: 'root',
})
export class ChroniaCalendarService {
  // Chronia epoch: December 22, 2015 (Gregorian) = Chronia Year 0, Month 1, Day 1
  private readonly CHRONIA_EPOCH_MS = Date.UTC(2015, 11, 22, 0, 0, 0, 0); // December 22, 2015

  // Constants
  private readonly DAYS_PER_MONTH = 28;
  private readonly MONTHS_PER_YEAR = 13;
  private readonly STRUCTURED_DAYS_PER_YEAR = 364; // 13 * 28
  private readonly MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Month names for Chronia calendar (neutralized naming system)
  private readonly MONTH_NAMES = [
    'Unana', // Month 1 - Root "Un" = start, unity
    'Dunana', // Month 2 - Root "Du" = two-like hint
    'Trunana', // Month 3 - Root "Tru" = three-like hint
    'Quarnana', // Month 4 - Root "Quar" = four-like hint
    'Pentana', // Month 5 - Root "Pen" = five-like hint
    'Hexana', // Month 6 - Root "Hex" = six-like hint
    'Sevana', // Month 7 - Root "Sev" = seven-like hint
    'Ovana', // Month 8 - Root "Ov" = eight-like hint
    'Nonana', // Month 9 - Root "Non" = nine-like hint
    'Dekana', // Month 10 - Root "Dek" = ten-like hint
    'Endana', // Month 11 - Root "End" = eleven-like hint
    'Dovana', // Month 12 - Root "Dov" = twelve-like hint
    'Triskana', // Month 13 - Root "Tris" = thirteen-like hint
  ];

  /**
   * Check if a Chronia year is a leap year
   * Uses the same rule as Gregorian calendar
   */
  isLeapYear(year: number): boolean {
    if (year % 400 === 0) return true;
    if (year % 100 === 0) return false;
    if (year % 4 === 0) return true;
    return false;
  }

  /**
   * Get the total days in a Chronia year
   */
  getDaysInYear(year: number): number {
    // 364 structured days + 1 Solstice Day + (1 Leap Day if leap year)
    return this.STRUCTURED_DAYS_PER_YEAR + 1 + (this.isLeapYear(year) ? 1 : 0);
  }

  /**
   * Convert a Unix timestamp (seconds) to Chronia date
   */
  fromUnixTimestamp(timestamp: number): ChroniaDateTime {
    const date = new Date(timestamp * 1000);
    return this.fromDate(date);
  }

  /**
   * Convert a JavaScript Date to Chronia date
   */
  fromDate(date: Date): ChroniaDateTime {
    const utcMs = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    );

    // Calculate days since Chronia epoch
    const daysSinceEpoch = Math.floor((utcMs - this.CHRONIA_EPOCH_MS) / this.MS_PER_DAY);

    // Handle dates before Chronia epoch
    if (daysSinceEpoch < 0) {
      return this.fromDaysSinceEpochNegative(daysSinceEpoch, date);
    }

    return this.fromDaysSinceEpochPositive(daysSinceEpoch, date);
  }

  /**
   * Convert positive days since epoch to Chronia date
   */
  private fromDaysSinceEpochPositive(daysSinceEpoch: number, originalDate: Date): ChroniaDateTime {
    let remainingDays = daysSinceEpoch;
    let year = 0;

    // Find the year
    while (true) {
      const daysInYear = this.getDaysInYear(year);
      if (remainingDays < daysInYear) {
        break;
      }
      remainingDays -= daysInYear;
      year++;
    }

    // Now remainingDays is the day within the year (0-indexed)
    const isLeap = this.isLeapYear(year);
    const structuredDays = this.STRUCTURED_DAYS_PER_YEAR;

    // Check if it's a special day
    if (remainingDays >= structuredDays) {
      const specialDayIndex = remainingDays - structuredDays; // 0 = first special day

      if (isLeap) {
        // Leap year: Leap Day comes before Solstice Day
        if (specialDayIndex === 0) {
          return {
            year,
            month: 0,
            day: 0,
            isLeapDay: true,
            isSolsticeDay: false,
            hour: originalDate.getUTCHours(),
            minute: originalDate.getUTCMinutes(),
            second: originalDate.getUTCSeconds(),
          };
        } else {
          // Solstice Day
          return {
            year,
            month: 0,
            day: 0,
            isLeapDay: false,
            isSolsticeDay: true,
            hour: originalDate.getUTCHours(),
            minute: originalDate.getUTCMinutes(),
            second: originalDate.getUTCSeconds(),
          };
        }
      } else {
        // Non-leap year: Only Solstice Day
        return {
          year,
          month: 0,
          day: 0,
          isLeapDay: false,
          isSolsticeDay: true,
          hour: originalDate.getUTCHours(),
          minute: originalDate.getUTCMinutes(),
          second: originalDate.getUTCSeconds(),
        };
      }
    }

    // Regular day within the 364-day structure
    const month = Math.floor(remainingDays / this.DAYS_PER_MONTH) + 1;
    const day = (remainingDays % this.DAYS_PER_MONTH) + 1;

    return {
      year,
      month,
      day,
      isLeapDay: false,
      isSolsticeDay: false,
      hour: originalDate.getUTCHours(),
      minute: originalDate.getUTCMinutes(),
      second: originalDate.getUTCSeconds(),
    };
  }

  /**
   * Convert negative days since epoch to Chronia date (dates before epoch)
   */
  private fromDaysSinceEpochNegative(daysSinceEpoch: number, originalDate: Date): ChroniaDateTime {
    let remainingDays = -daysSinceEpoch - 1; // Convert to positive, 0-indexed backwards
    let year = -1;

    // Find the year (going backwards)
    while (true) {
      const daysInYear = this.getDaysInYear(year);
      if (remainingDays < daysInYear) {
        break;
      }
      remainingDays -= daysInYear;
      year--;
    }

    // Calculate the day within the year (from end)
    const daysInYear = this.getDaysInYear(year);
    const dayInYear = daysInYear - 1 - remainingDays;

    const isLeap = this.isLeapYear(year);
    const structuredDays = this.STRUCTURED_DAYS_PER_YEAR;

    // Check if it's a special day
    if (dayInYear >= structuredDays) {
      const specialDayIndex = dayInYear - structuredDays;

      if (isLeap) {
        if (specialDayIndex === 0) {
          return {
            year,
            month: 0,
            day: 0,
            isLeapDay: true,
            isSolsticeDay: false,
            hour: originalDate.getUTCHours(),
            minute: originalDate.getUTCMinutes(),
            second: originalDate.getUTCSeconds(),
          };
        } else {
          return {
            year,
            month: 0,
            day: 0,
            isLeapDay: false,
            isSolsticeDay: true,
            hour: originalDate.getUTCHours(),
            minute: originalDate.getUTCMinutes(),
            second: originalDate.getUTCSeconds(),
          };
        }
      } else {
        return {
          year,
          month: 0,
          day: 0,
          isLeapDay: false,
          isSolsticeDay: true,
          hour: originalDate.getUTCHours(),
          minute: originalDate.getUTCMinutes(),
          second: originalDate.getUTCSeconds(),
        };
      }
    }

    // Regular day
    const month = Math.floor(dayInYear / this.DAYS_PER_MONTH) + 1;
    const day = (dayInYear % this.DAYS_PER_MONTH) + 1;

    return {
      year,
      month,
      day,
      isLeapDay: false,
      isSolsticeDay: false,
      hour: originalDate.getUTCHours(),
      minute: originalDate.getUTCMinutes(),
      second: originalDate.getUTCSeconds(),
    };
  }

  /**
   * Get the month name
   */
  getMonthName(month: number): string {
    if (month < 1 || month > 13) {
      return '';
    }
    return this.MONTH_NAMES[month - 1];
  }

  /**
   * Format a Chronia date to a string
   * Supports formats: 'short', 'medium', 'long', 'full', 'shortDate', 'mediumDate', 'longDate', 'fullDate'
   */
  format(chroniaDate: ChroniaDateTime, format = 'medium'): string {
    if (chroniaDate.isSolsticeDay) {
      return this.formatSpecialDay('Solstice Day', chroniaDate, format);
    }
    if (chroniaDate.isLeapDay) {
      return this.formatSpecialDay('Leap Day', chroniaDate, format);
    }

    const year = chroniaDate.year.toString().padStart(2, '0');
    const month = chroniaDate.month.toString().padStart(2, '0');
    const day = chroniaDate.day.toString().padStart(2, '0');
    const monthName = this.getMonthName(chroniaDate.month);

    const hour = chroniaDate.hour.toString().padStart(2, '0');
    const minute = chroniaDate.minute.toString().padStart(2, '0');
    const second = chroniaDate.second.toString().padStart(2, '0');

    switch (format) {
      case 'short':
        return `${year}.${month}.${day} ${hour}:${minute}`;
      case 'shortDate':
        return `${year}.${month}.${day}`;
      case 'medium':
        return `${monthName} ${day}, ${year} ${hour}:${minute}:${second}`;
      case 'mediumDate':
        return `${monthName} ${day}, ${year}`;
      case 'long':
      case 'longDate':
        return `${monthName} ${day}, Year ${year}`;
      case 'full':
      case 'fullDate':
        return `Day ${day} of ${monthName}, Year ${year} of Chronia`;
      default:
        return `${year}.${month}.${day}`;
    }
  }

  /**
   * Format special days (Solstice Day or Leap Day)
   */
  private formatSpecialDay(dayName: string, chroniaDate: ChroniaDateTime, format: string): string {
    const year = chroniaDate.year.toString().padStart(2, '0');
    const hour = chroniaDate.hour.toString().padStart(2, '0');
    const minute = chroniaDate.minute.toString().padStart(2, '0');
    const second = chroniaDate.second.toString().padStart(2, '0');

    switch (format) {
      case 'short':
        return `${dayName} ${year} ${hour}:${minute}`;
      case 'shortDate':
        return `${dayName} ${year}`;
      case 'medium':
        return `${dayName}, Year ${year} ${hour}:${minute}:${second}`;
      case 'mediumDate':
        return `${dayName}, Year ${year}`;
      case 'long':
      case 'longDate':
      case 'full':
      case 'fullDate':
        return `${dayName} of Year ${year}`;
      default:
        return `${dayName} ${year}`;
    }
  }

  /**
   * Convert Unix timestamp (seconds) to formatted Chronia date string
   */
  formatUnixTimestamp(timestamp: number, format = 'medium'): string {
    const chroniaDate = this.fromUnixTimestamp(timestamp);
    return this.format(chroniaDate, format);
  }

  /**
   * Convert JavaScript Date to formatted Chronia date string
   */
  formatDate(date: Date, format = 'medium'): string {
    const chroniaDate = this.fromDate(date);
    return this.format(chroniaDate, format);
  }
}
