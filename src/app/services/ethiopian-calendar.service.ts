import { Injectable } from '@angular/core';

export interface EthiopianDate {
  year: number;
  month: number; // 1-13
  day: number; // 1-30 (or 1-5/6 for Pagume)
}

export interface EthiopianDateTime extends EthiopianDate {
  hour: number;
  minute: number;
  second: number;
}

/**
 * Ethiopian Calendar Service
 *
 * The Ethiopian Calendar (Ge'ez Calendar) is the principal calendar used in Ethiopia.
 *
 * Structure:
 * - 12 months of 30 days each = 360 days
 * - 1 month (Pagume) of 5 days (or 6 in a leap year) = 5-6 days
 * - Total: 365 or 366 days per year
 *
 * The Ethiopian calendar is approximately 7-8 years behind the Gregorian calendar.
 * Ethiopian New Year (Enkutatash) falls on September 11 (or September 12 in a Gregorian leap year).
 *
 * Leap year rule:
 * - Ethiopian year is a leap year if (year + 1) % 4 === 0
 * - This means years 3, 7, 11, 15... are leap years (1 year before Gregorian leap year pattern)
 *
 * Epoch reference:
 * - Ethiopian Year 1, Month 1, Day 1 = August 29, 8 AD (Julian) = approximately September 11, 8 AD (proleptic Gregorian)
 *
 * For practical conversion, we use:
 * - September 11, 2015 Gregorian = Meskerem 1, 2008 Ethiopian (non-leap year)
 */
@Injectable({
  providedIn: 'root',
})
export class EthiopianCalendarService {
  // Ethiopian epoch offset in days from Unix epoch (January 1, 1970)
  // September 11, 1970 (Gregorian) = Meskerem 1, 1963 (Ethiopian)
  private readonly MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Reference point: September 11, 2015 = Meskerem 1, 2008 Ethiopian
  private readonly REFERENCE_GREGORIAN = new Date(Date.UTC(2015, 8, 11, 0, 0, 0, 0)); // September 11, 2015
  private readonly REFERENCE_ETHIOPIAN_YEAR = 2008;

  /**
   * Get localized month names for Ethiopian calendar
   * Uses $localize for i18n support
   */
  private getMonthNames(): string[] {
    return [
      $localize`:@@ethiopian.month.1:Meskerem`,
      $localize`:@@ethiopian.month.2:Tikimt`,
      $localize`:@@ethiopian.month.3:Hidar`,
      $localize`:@@ethiopian.month.4:Tahsas`,
      $localize`:@@ethiopian.month.5:Tir`,
      $localize`:@@ethiopian.month.6:Yekatit`,
      $localize`:@@ethiopian.month.7:Megabit`,
      $localize`:@@ethiopian.month.8:Miazia`,
      $localize`:@@ethiopian.month.9:Ginbot`,
      $localize`:@@ethiopian.month.10:Sene`,
      $localize`:@@ethiopian.month.11:Hamle`,
      $localize`:@@ethiopian.month.12:Nehase`,
      $localize`:@@ethiopian.month.13:Pagume`,
    ];
  }

  /**
   * Get localized short month names for Ethiopian calendar
   */
  private getShortMonthNames(): string[] {
    return [
      $localize`:@@ethiopian.month.short.1:Mes`,
      $localize`:@@ethiopian.month.short.2:Tik`,
      $localize`:@@ethiopian.month.short.3:Hid`,
      $localize`:@@ethiopian.month.short.4:Tah`,
      $localize`:@@ethiopian.month.short.5:Tir`,
      $localize`:@@ethiopian.month.short.6:Yek`,
      $localize`:@@ethiopian.month.short.7:Meg`,
      $localize`:@@ethiopian.month.short.8:Mia`,
      $localize`:@@ethiopian.month.short.9:Gin`,
      $localize`:@@ethiopian.month.short.10:Sen`,
      $localize`:@@ethiopian.month.short.11:Ham`,
      $localize`:@@ethiopian.month.short.12:Neh`,
      $localize`:@@ethiopian.month.short.13:Pag`,
    ];
  }

  getYearLabel(): string {
    return $localize`:@@ethiopian.year-label:Year`;
  }

  getCalendarName(): string {
    return $localize`:@@ethiopian.calendar-name:Ethiopian Calendar`;
  }

  /**
   * Check if an Ethiopian year is a leap year
   * Ethiopian leap years occur when (year + 1) % 4 === 0
   */
  isLeapYear(year: number): boolean {
    return (year + 1) % 4 === 0;
  }

  /**
   * Get the total days in an Ethiopian year
   */
  getDaysInYear(year: number): number {
    return this.isLeapYear(year) ? 366 : 365;
  }

  /**
   * Get days in a specific Ethiopian month
   */
  getDaysInMonth(year: number, month: number): number {
    if (month >= 1 && month <= 12) {
      return 30;
    }
    if (month === 13) {
      return this.isLeapYear(year) ? 6 : 5;
    }
    return 0;
  }

  /**
   * Convert a Unix timestamp (seconds) to Ethiopian date
   */
  fromUnixTimestamp(timestamp: number): EthiopianDateTime {
    const date = new Date(timestamp * 1000);
    return this.fromDate(date);
  }

  /**
   * Convert a JavaScript Date to Ethiopian date
   */
  fromDate(date: Date): EthiopianDateTime {
    // Calculate days since reference date
    const utcMs = Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    );
    const referenceMs = this.REFERENCE_GREGORIAN.getTime();
    const daysDiff = Math.floor((utcMs - referenceMs) / this.MS_PER_DAY);

    // Start from the reference Ethiopian date
    let ethiopianYear = this.REFERENCE_ETHIOPIAN_YEAR;
    let remainingDays = daysDiff;

    if (remainingDays >= 0) {
      // Forward from reference
      while (remainingDays >= this.getDaysInYear(ethiopianYear)) {
        remainingDays -= this.getDaysInYear(ethiopianYear);
        ethiopianYear++;
      }
    } else {
      // Backward from reference
      ethiopianYear--;
      remainingDays += this.getDaysInYear(ethiopianYear);
      while (remainingDays < 0) {
        ethiopianYear--;
        remainingDays += this.getDaysInYear(ethiopianYear);
      }
    }

    // Now remainingDays is the day-of-year (0-indexed)
    let month = 1;
    while (remainingDays >= this.getDaysInMonth(ethiopianYear, month)) {
      remainingDays -= this.getDaysInMonth(ethiopianYear, month);
      month++;
    }

    const day = remainingDays + 1; // Convert to 1-indexed

    return {
      year: ethiopianYear,
      month,
      day,
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }

  /**
   * Convert Ethiopian date to JavaScript Date
   */
  toDate(ethiopianDate: EthiopianDate): Date {
    // Calculate days from reference Ethiopian date
    let daysDiff = 0;

    if (ethiopianDate.year >= this.REFERENCE_ETHIOPIAN_YEAR) {
      // Forward from reference
      for (let y = this.REFERENCE_ETHIOPIAN_YEAR; y < ethiopianDate.year; y++) {
        daysDiff += this.getDaysInYear(y);
      }
    } else {
      // Backward from reference
      for (let y = this.REFERENCE_ETHIOPIAN_YEAR - 1; y >= ethiopianDate.year; y--) {
        daysDiff -= this.getDaysInYear(y);
      }
    }

    // Add days for completed months in the target year
    for (let m = 1; m < ethiopianDate.month; m++) {
      daysDiff += this.getDaysInMonth(ethiopianDate.year, m);
    }

    // Add remaining days (convert from 1-indexed to 0-indexed)
    daysDiff += ethiopianDate.day - 1;

    // Calculate the Gregorian date
    const resultMs = this.REFERENCE_GREGORIAN.getTime() + daysDiff * this.MS_PER_DAY;
    return new Date(resultMs);
  }

  /**
   * Get the month name
   */
  getMonthName(month: number): string {
    if (month < 1 || month > 13) {
      return '';
    }
    return this.getMonthNames()[month - 1];
  }

  /**
   * Get the short month name
   */
  getShortMonthName(month: number): string {
    if (month < 1 || month > 13) {
      return '';
    }
    return this.getShortMonthNames()[month - 1];
  }

  /**
   * Format an Ethiopian date to a string
   * Supports formats: 'short', 'medium', 'long', 'full', 'shortDate', 'mediumDate', 'longDate', 'fullDate', 'time'
   */
  format(ethiopianDate: EthiopianDateTime, format = 'medium', timeFormat: '12h' | '24h' = '24h'): string {
    const { year, month, day, hour, minute, second } = ethiopianDate;
    const monthName = this.getMonthName(month);
    const shortMonthName = this.getShortMonthName(month);

    // Format time based on preference
    const minuteStr = minute.toString().padStart(2, '0');
    const secondStr = second.toString().padStart(2, '0');

    let timeStr: string;
    let timeStrWithSeconds: string;
    if (timeFormat === '24h') {
      timeStr = `${hour.toString().padStart(2, '0')}:${minuteStr}`;
      timeStrWithSeconds = `${hour.toString().padStart(2, '0')}:${minuteStr}:${secondStr}`;
    } else {
      const hour12 = hour % 12 || 12;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      timeStr = `${hour12}:${minuteStr} ${ampm}`;
      timeStrWithSeconds = `${hour12}:${minuteStr}:${secondStr} ${ampm}`;
    }

    switch (format) {
      case 'time':
        return timeStr;
      case 'short':
        return `${month}/${day}/${year % 100}, ${timeStr}`;
      case 'shortDate':
        return `${month}/${day}/${year % 100}`;
      case 'medium':
        return `${monthName} ${day}, ${year}, ${timeStrWithSeconds}`;
      case 'mediumDate':
        return `${monthName} ${day}, ${year}`;
      case 'long':
        return `${monthName} ${day}, ${year}, ${timeStrWithSeconds}`;
      case 'longDate':
        return `${monthName} ${day}, ${year}`;
      case 'full':
        return `${monthName} ${day}, ${year}, ${timeStrWithSeconds}`;
      case 'fullDate':
        return `${monthName} ${day}, ${year}`;
      default:
        return `${shortMonthName} ${day}, ${year}`;
    }
  }

  /**
   * Convert Unix timestamp (seconds) to formatted Ethiopian date string
   */
  formatUnixTimestamp(timestamp: number, format = 'medium', timeFormat: '12h' | '24h' = '24h'): string {
    const ethiopianDate = this.fromUnixTimestamp(timestamp);
    return this.format(ethiopianDate, format, timeFormat);
  }

  /**
   * Convert JavaScript Date to formatted Ethiopian date string
   */
  formatDate(date: Date, format = 'medium'): string {
    const ethiopianDate = this.fromDate(date);
    return this.format(ethiopianDate, format);
  }
}
