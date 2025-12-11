import { Injectable } from '@angular/core';

/**
 * Gregorian Calendar Service
 *
 * Provides localized month names for the Gregorian calendar system.
 * Uses $localize for i18n support.
 */
@Injectable({
  providedIn: 'root',
})
export class GregorianCalendarService {
  /**
   * Get localized full month names (January, February, etc.)
   */
  getMonthNames(): string[] {
    return [
      $localize`:@@gregorian.month.1:January`,
      $localize`:@@gregorian.month.2:February`,
      $localize`:@@gregorian.month.3:March`,
      $localize`:@@gregorian.month.4:April`,
      $localize`:@@gregorian.month.5:May`,
      $localize`:@@gregorian.month.6:June`,
      $localize`:@@gregorian.month.7:July`,
      $localize`:@@gregorian.month.8:August`,
      $localize`:@@gregorian.month.9:September`,
      $localize`:@@gregorian.month.10:October`,
      $localize`:@@gregorian.month.11:November`,
      $localize`:@@gregorian.month.12:December`,
    ];
  }

  /**
   * Get localized short month names (Jan, Feb, etc.)
   */
  getShortMonthNames(): string[] {
    return [
      $localize`:@@gregorian.month.short.1:Jan`,
      $localize`:@@gregorian.month.short.2:Feb`,
      $localize`:@@gregorian.month.short.3:Mar`,
      $localize`:@@gregorian.month.short.4:Apr`,
      $localize`:@@gregorian.month.short.5:May`,
      $localize`:@@gregorian.month.short.6:Jun`,
      $localize`:@@gregorian.month.short.7:Jul`,
      $localize`:@@gregorian.month.short.8:Aug`,
      $localize`:@@gregorian.month.short.9:Sep`,
      $localize`:@@gregorian.month.short.10:Oct`,
      $localize`:@@gregorian.month.short.11:Nov`,
      $localize`:@@gregorian.month.short.12:Dec`,
    ];
  }

  /**
   * Get localized month name by number (1-12)
   */
  getMonthName(month: number): string {
    if (month < 1 || month > 12) {
      return '';
    }
    return this.getMonthNames()[month - 1];
  }

  /**
   * Get localized short month name by number (1-12)
   */
  getShortMonthName(month: number): string {
    if (month < 1 || month > 12) {
      return '';
    }
    return this.getShortMonthNames()[month - 1];
  }

  /**
   * Format a Date to a localized string
   */
  format(date: Date, formatType: 'short' | 'medium' | 'long' | 'full' = 'medium'): string {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const monthName = this.getMonthName(month);
    const shortMonthName = this.getShortMonthName(month);

    switch (formatType) {
      case 'short':
        return `${shortMonthName} ${day}, ${year}`;
      case 'medium':
        return `${monthName} ${day}, ${year}`;
      case 'long':
      case 'full':
        return `${monthName} ${day}, ${year}`;
      default:
        return `${monthName} ${day}, ${year}`;
    }
  }

  /**
   * Format a Unix timestamp (seconds) to a localized string
   */
  formatUnixTimestamp(timestamp: number, formatType: 'short' | 'medium' | 'long' | 'full' = 'medium'): string {
    const date = new Date(timestamp * 1000);
    return this.format(date, formatType);
  }

  /**
   * Get localized full weekday names (Sunday, Monday, etc.)
   * Index 0 = Sunday, 1 = Monday, ..., 6 = Saturday
   */
  getWeekdayNames(): string[] {
    return [
      $localize`:@@gregorian.weekday.0:Sunday`,
      $localize`:@@gregorian.weekday.1:Monday`,
      $localize`:@@gregorian.weekday.2:Tuesday`,
      $localize`:@@gregorian.weekday.3:Wednesday`,
      $localize`:@@gregorian.weekday.4:Thursday`,
      $localize`:@@gregorian.weekday.5:Friday`,
      $localize`:@@gregorian.weekday.6:Saturday`,
    ];
  }

  /**
   * Get localized short weekday names (Sun, Mon, etc.)
   * Index 0 = Sunday, 1 = Monday, ..., 6 = Saturday
   */
  getShortWeekdayNames(): string[] {
    return [
      $localize`:@@gregorian.weekday.short.0:Sun`,
      $localize`:@@gregorian.weekday.short.1:Mon`,
      $localize`:@@gregorian.weekday.short.2:Tue`,
      $localize`:@@gregorian.weekday.short.3:Wed`,
      $localize`:@@gregorian.weekday.short.4:Thu`,
      $localize`:@@gregorian.weekday.short.5:Fri`,
      $localize`:@@gregorian.weekday.short.6:Sat`,
    ];
  }

  /**
   * Get localized weekday name by day number (0-6, where 0 = Sunday)
   */
  getWeekdayName(day: number): string {
    if (day < 0 || day > 6) {
      return '';
    }
    return this.getWeekdayNames()[day];
  }

  /**
   * Get localized short weekday name by day number (0-6, where 0 = Sunday)
   */
  getShortWeekdayName(day: number): string {
    if (day < 0 || day > 6) {
      return '';
    }
    return this.getShortWeekdayNames()[day];
  }

  /**
   * Format a Date to a localized string with weekday
   */
  formatWithWeekday(date: Date, formatType: 'short' | 'medium' | 'long' | 'full' = 'medium'): string {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const weekday = date.getDay();
    const monthName = this.getMonthName(month);
    const weekdayName = this.getWeekdayName(weekday);
    const shortWeekdayName = this.getShortWeekdayName(weekday);

    switch (formatType) {
      case 'short':
        return `${shortWeekdayName}, ${this.getShortMonthName(month)} ${day}, ${year}`;
      case 'medium':
        return `${weekdayName}, ${monthName} ${day}, ${year}`;
      case 'long':
      case 'full':
        return `${weekdayName}, ${monthName} ${day}, ${year}`;
      default:
        return `${weekdayName}, ${monthName} ${day}, ${year}`;
    }
  }
}
