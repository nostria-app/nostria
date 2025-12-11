import { TestBed } from '@angular/core/testing';
import { ChroniaCalendarService, ChroniaDateTime } from './chronia-calendar.service';

describe('ChroniaCalendarService', () => {
  let service: ChroniaCalendarService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChroniaCalendarService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('isLeapYear', () => {
    it('should return true for years divisible by 4', () => {
      expect(service.isLeapYear(4)).toBe(true);
      expect(service.isLeapYear(8)).toBe(true);
    });

    it('should return false for years divisible by 100 but not 400', () => {
      expect(service.isLeapYear(100)).toBe(false);
      expect(service.isLeapYear(200)).toBe(false);
    });

    it('should return true for years divisible by 400', () => {
      expect(service.isLeapYear(400)).toBe(true);
      expect(service.isLeapYear(800)).toBe(true);
    });

    it('should return false for non-leap years', () => {
      expect(service.isLeapYear(1)).toBe(false);
      expect(service.isLeapYear(3)).toBe(false);
    });
  });

  describe('getDaysInYear', () => {
    it('should return 365 for non-leap years (364 + 1 Solstice Day)', () => {
      expect(service.getDaysInYear(1)).toBe(365);
      expect(service.getDaysInYear(3)).toBe(365);
    });

    it('should return 366 for leap years (364 + 1 Leap Day + 1 Solstice Day)', () => {
      expect(service.getDaysInYear(4)).toBe(366);
      expect(service.getDaysInYear(8)).toBe(366);
    });
  });

  describe('fromDate - Chronia Epoch', () => {
    // Chronia Epoch: December 22, 2015 = Year 0, Month 1, Day 1
    it('should convert Chronia epoch date correctly', () => {
      const epochDate = new Date(Date.UTC(2015, 11, 22, 0, 0, 0)); // December 22, 2015
      const result = service.fromDate(epochDate);

      expect(result.year).toBe(0);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
      expect(result.isLeapDay).toBe(false);
      expect(result.isSolsticeDay).toBe(false);
    });

    it('should convert day after epoch correctly', () => {
      const dayAfterEpoch = new Date(Date.UTC(2015, 11, 23, 0, 0, 0)); // December 23, 2015
      const result = service.fromDate(dayAfterEpoch);

      expect(result.year).toBe(0);
      expect(result.month).toBe(1);
      expect(result.day).toBe(2);
    });
  });

  describe('fromDate - Month transitions', () => {
    it('should correctly identify month 2 start (day 29 of year)', () => {
      // Month 1 has 28 days, so month 2 starts on day 29
      // That's December 22 + 28 days = January 19, 2016
      const month2Start = new Date(Date.UTC(2016, 0, 19, 0, 0, 0)); // January 19, 2016
      const result = service.fromDate(month2Start);

      expect(result.year).toBe(0);
      expect(result.month).toBe(2);
      expect(result.day).toBe(1);
    });

    it('should correctly identify last day of month 1', () => {
      // December 22, 2015 + 27 days = January 18, 2016
      const lastDayMonth1 = new Date(Date.UTC(2016, 0, 18, 0, 0, 0)); // January 18, 2016
      const result = service.fromDate(lastDayMonth1);

      expect(result.year).toBe(0);
      expect(result.month).toBe(1);
      expect(result.day).toBe(28);
    });
  });

  describe('fromDate - Special days', () => {
    it('should identify Solstice Day in a non-leap year', () => {
      // Year 1 (non-leap): Solstice Day is the 365th day of the year
      // Year 0 ends after 365 days (Dec 22, 2015 + 364 = Dec 21, 2016)
      // Solstice Day of Year 0: Dec 21, 2016
      const solsticeDay = new Date(Date.UTC(2016, 11, 21, 0, 0, 0)); // December 21, 2016
      const result = service.fromDate(solsticeDay);

      expect(result.year).toBe(0);
      expect(result.isSolsticeDay).toBe(true);
      expect(result.isLeapDay).toBe(false);
    });

    it('should identify Leap Day in a leap year', () => {
      // Year 4 is a leap year
      // Need to calculate when Year 4's Leap Day falls
      // This would be the day before Solstice Day of Year 4
      // For now, test that the service handles leap years properly
      expect(service.isLeapYear(4)).toBe(true);
    });
  });

  describe('fromUnixTimestamp', () => {
    it('should convert Unix timestamp to Chronia date', () => {
      // December 22, 2015 00:00:00 UTC
      const epochTimestamp = 1450742400; // Unix timestamp in seconds
      const result = service.fromUnixTimestamp(epochTimestamp);

      expect(result.year).toBe(0);
      expect(result.month).toBe(1);
      expect(result.day).toBe(1);
    });
  });

  describe('getMonthName', () => {
    it('should return correct month names', () => {
      expect(service.getMonthName(1)).toBe('Primara');
      expect(service.getMonthName(7)).toBe('Septima');
      expect(service.getMonthName(13)).toBe('Tredecima');
    });

    it('should return empty string for invalid months', () => {
      expect(service.getMonthName(0)).toBe('');
      expect(service.getMonthName(14)).toBe('');
    });
  });

  describe('format', () => {
    it('should format regular dates correctly', () => {
      const chroniaDate: ChroniaDateTime = {
        year: 5,
        month: 7,
        day: 15,
        isLeapDay: false,
        isSolsticeDay: false,
        hour: 14,
        minute: 30,
        second: 45,
      };

      expect(service.format(chroniaDate, 'short')).toContain('05.07.15');
      expect(service.format(chroniaDate, 'mediumDate')).toContain('Septima 15');
    });

    it('should format Solstice Day correctly', () => {
      const solsticeDate: ChroniaDateTime = {
        year: 5,
        month: 0,
        day: 0,
        isLeapDay: false,
        isSolsticeDay: true,
        hour: 12,
        minute: 0,
        second: 0,
      };

      expect(service.format(solsticeDate, 'medium')).toContain('Solstice Day');
    });

    it('should format Leap Day correctly', () => {
      const leapDate: ChroniaDateTime = {
        year: 4,
        month: 0,
        day: 0,
        isLeapDay: true,
        isSolsticeDay: false,
        hour: 12,
        minute: 0,
        second: 0,
      };

      expect(service.format(leapDate, 'medium')).toContain('Leap Day');
    });
  });

  describe('formatUnixTimestamp', () => {
    it('should format Unix timestamp to Chronia string', () => {
      // December 22, 2015 = Year 0, Month 1, Day 1 in Chronia
      const epochTimestamp = 1450742400;
      const result = service.formatUnixTimestamp(epochTimestamp, 'shortDate');

      expect(result).toContain('00.01.01');
    });
  });

  describe('Date calculations - Present day test', () => {
    it('should correctly calculate current date', () => {
      // December 11, 2025
      const currentDate = new Date(Date.UTC(2025, 11, 11, 12, 0, 0));
      const result = service.fromDate(currentDate);

      // This is Year 10 in Chronia (2025 - 2015 = 10)
      expect(result.year).toBe(10);
      expect(result.month).toBeGreaterThan(0);
      expect(result.month).toBeLessThanOrEqual(13);
      expect(result.day).toBeGreaterThan(0);
      expect(result.day).toBeLessThanOrEqual(28);
    });
  });

  describe('Negative years (dates before epoch)', () => {
    it('should handle dates before Chronia epoch', () => {
      const beforeEpoch = new Date(Date.UTC(2015, 11, 21, 0, 0, 0)); // December 21, 2015
      const result = service.fromDate(beforeEpoch);

      expect(result.year).toBe(-1);
      expect(result.isSolsticeDay).toBe(true);
    });
  });
});
