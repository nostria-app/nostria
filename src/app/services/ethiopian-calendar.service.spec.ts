import { TestBed } from '@angular/core/testing';
import { EthiopianCalendarService } from './ethiopian-calendar.service';

describe('EthiopianCalendarService', () => {
  let service: EthiopianCalendarService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EthiopianCalendarService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('isLeapYear', () => {
    it('should return true for Ethiopian leap years', () => {
      // Ethiopian leap years occur when (year + 1) % 4 === 0
      // So years 3, 7, 11, 15, etc. are leap years
      expect(service.isLeapYear(3)).toBe(true);
      expect(service.isLeapYear(7)).toBe(true);
      expect(service.isLeapYear(11)).toBe(true);
      expect(service.isLeapYear(2007)).toBe(true);
      expect(service.isLeapYear(2011)).toBe(true);
    });

    it('should return false for non-leap years', () => {
      expect(service.isLeapYear(1)).toBe(false);
      expect(service.isLeapYear(2)).toBe(false);
      expect(service.isLeapYear(4)).toBe(false);
      expect(service.isLeapYear(2008)).toBe(false);
      expect(service.isLeapYear(2009)).toBe(false);
    });
  });

  describe('getDaysInYear', () => {
    it('should return 365 for non-leap years', () => {
      expect(service.getDaysInYear(2008)).toBe(365);
      expect(service.getDaysInYear(2009)).toBe(365);
    });

    it('should return 366 for leap years', () => {
      expect(service.getDaysInYear(2007)).toBe(366);
      expect(service.getDaysInYear(2011)).toBe(366);
    });
  });

  describe('getDaysInMonth', () => {
    it('should return 30 for months 1-12', () => {
      for (let month = 1; month <= 12; month++) {
        expect(service.getDaysInMonth(2008, month)).toBe(30);
      }
    });

    it('should return 5 for Pagume (month 13) in non-leap years', () => {
      expect(service.getDaysInMonth(2008, 13)).toBe(5);
    });

    it('should return 6 for Pagume (month 13) in leap years', () => {
      expect(service.getDaysInMonth(2007, 13)).toBe(6);
    });
  });

  describe('fromDate - Reference date', () => {
    // Reference: September 11, 2015 = Meskerem 1, 2008 Ethiopian
    it('should convert reference date correctly', () => {
      const refDate = new Date(Date.UTC(2015, 8, 11, 0, 0, 0)); // September 11, 2015
      const result = service.fromDate(refDate);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
    });

    it('should convert day after reference correctly', () => {
      const dayAfterRef = new Date(Date.UTC(2015, 8, 12, 0, 0, 0)); // September 12, 2015
      const result = service.fromDate(dayAfterRef);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(1);
      expect(result.day).toBe(2);
    });
  });

  describe('fromDate - Month transitions', () => {
    it('should correctly identify start of month 2 (Tikimt)', () => {
      // Meskerem has 30 days, so Tikimt 1, 2008 = September 11 + 30 = October 11, 2015
      const tikimtStart = new Date(Date.UTC(2015, 9, 11, 0, 0, 0)); // October 11, 2015
      const result = service.fromDate(tikimtStart);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(2);
      expect(result.day).toBe(1);
    });

    it('should correctly identify last day of Meskerem', () => {
      // Meskerem 30, 2008 = September 11 + 29 = October 10, 2015
      const meskeremEnd = new Date(Date.UTC(2015, 9, 10, 0, 0, 0)); // October 10, 2015
      const result = service.fromDate(meskeremEnd);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(1);
      expect(result.day).toBe(30);
    });
  });

  describe('fromDate - Year transitions', () => {
    it('should handle Ethiopian New Year correctly', () => {
      // Ethiopian New Year 2009 should be around September 11, 2016
      const newYear2009 = new Date(Date.UTC(2016, 8, 10, 0, 0, 0)); // September 10, 2016
      const result = service.fromDate(newYear2009);

      expect(result.year).toBe(2009);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
    });
  });

  describe('fromDate - Pagume (13th month)', () => {
    it('should correctly identify Pagume 1', () => {
      // Pagume 1, 2008 = September 11 + (12 * 30) = September 11 + 360 = September 6, 2016
      const pagume1 = new Date(Date.UTC(2016, 8, 5, 0, 0, 0)); // September 5, 2016
      const result = service.fromDate(pagume1);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(13);
      expect(result.day).toBe(1);
    });
  });

  describe('fromUnixTimestamp', () => {
    it('should convert Unix timestamp to Ethiopian date', () => {
      // September 11, 2015 00:00:00 UTC = 1441929600 Unix timestamp
      const timestamp = Math.floor(new Date(Date.UTC(2015, 8, 11, 0, 0, 0)).getTime() / 1000);
      const result = service.fromUnixTimestamp(timestamp);

      expect(result.year).toBe(2008);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
    });
  });

  describe('getMonthName', () => {
    it('should return correct month names', () => {
      expect(service.getMonthName(1)).toBe('Meskerem');
      expect(service.getMonthName(13)).toBe('Pagume');
    });

    it('should return empty string for invalid months', () => {
      expect(service.getMonthName(0)).toBe('');
      expect(service.getMonthName(14)).toBe('');
    });
  });

  describe('format', () => {
    it('should format Ethiopian dates correctly', () => {
      const ethiopianDate = {
        year: 2008,
        month: 1,
        day: 1,
        hour: 12,
        minute: 30,
        second: 45,
      };

      const result = service.format(ethiopianDate, 'mediumDate');
      expect(result).toBe('Meskerem 1, 2008');
    });

    it('should format short date correctly', () => {
      const ethiopianDate = {
        year: 2008,
        month: 1,
        day: 15,
        hour: 10,
        minute: 30,
        second: 0,
      };

      const result = service.format(ethiopianDate, 'shortDate');
      expect(result).toBe('1/15/8');
    });
  });

  describe('formatUnixTimestamp', () => {
    it('should format Unix timestamp to Ethiopian string', () => {
      const timestamp = Math.floor(new Date(Date.UTC(2015, 8, 11, 12, 30, 45)).getTime() / 1000);
      const result = service.formatUnixTimestamp(timestamp, 'mediumDate');

      expect(result).toBe('Meskerem 1, 2008');
    });
  });

  describe('toDate - Round trip conversion', () => {
    it('should convert Ethiopian date back to Gregorian correctly', () => {
      const ethiopianDate = { year: 2008, month: 1, day: 1 };
      const gregorianDate = service.toDate(ethiopianDate);

      expect(gregorianDate.getUTCFullYear()).toBe(2015);
      expect(gregorianDate.getUTCMonth()).toBe(8); // September (0-indexed)
      expect(gregorianDate.getUTCDate()).toBe(11);
    });

    it('should round-trip correctly', () => {
      const originalDate = new Date(Date.UTC(2020, 5, 15, 0, 0, 0)); // June 15, 2020
      const ethiopianDate = service.fromDate(originalDate);
      const convertedBack = service.toDate(ethiopianDate);

      expect(convertedBack.getUTCFullYear()).toBe(originalDate.getUTCFullYear());
      expect(convertedBack.getUTCMonth()).toBe(originalDate.getUTCMonth());
      expect(convertedBack.getUTCDate()).toBe(originalDate.getUTCDate());
    });
  });

  describe('Date calculations - Present day test', () => {
    it('should correctly calculate current date', () => {
      const now = new Date();
      const ethiopianNow = service.fromDate(now);

      // Basic sanity checks
      expect(ethiopianNow.year).toBeGreaterThan(2000);
      expect(ethiopianNow.month).toBeGreaterThanOrEqual(1);
      expect(ethiopianNow.month).toBeLessThanOrEqual(13);
      expect(ethiopianNow.day).toBeGreaterThanOrEqual(1);
      expect(ethiopianNow.day).toBeLessThanOrEqual(30);
    });
  });

  describe('Dates before reference', () => {
    it('should handle dates before reference date', () => {
      const beforeRef = new Date(Date.UTC(2014, 8, 11, 0, 0, 0)); // September 11, 2014
      const result = service.fromDate(beforeRef);

      expect(result.year).toBe(2007);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
    });
  });
});
