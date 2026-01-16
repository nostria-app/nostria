import { TestBed } from '@angular/core/testing';
import { PlatformService } from './platform.service';

describe('PlatformService', () => {
  let service: PlatformService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlatformService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('hasModifierKey', () => {
    it('should return true for Alt key on Windows/Linux', () => {
      // Mock non-Mac platform
      service.isMac.set(false);
      
      const event = new KeyboardEvent('keydown', {
        altKey: true,
        metaKey: false,
        ctrlKey: false,
      });

      expect(service.hasModifierKey(event)).toBe(true);
    });

    it('should return false for Alt key on Mac (should use Cmd)', () => {
      // Mock Mac platform
      service.isMac.set(true);
      
      const event = new KeyboardEvent('keydown', {
        altKey: true,
        metaKey: false,
        ctrlKey: false,
      });

      expect(service.hasModifierKey(event)).toBe(false);
    });

    it('should return true for Cmd (Meta) key on Mac', () => {
      // Mock Mac platform
      service.isMac.set(true);
      
      const event = new KeyboardEvent('keydown', {
        altKey: false,
        metaKey: true,
        ctrlKey: false,
      });

      expect(service.hasModifierKey(event)).toBe(true);
    });

    it('should return false for Cmd (Meta) key on Windows/Linux', () => {
      // Mock non-Mac platform
      service.isMac.set(false);
      
      const event = new KeyboardEvent('keydown', {
        altKey: false,
        metaKey: true,
        ctrlKey: false,
      });

      expect(service.hasModifierKey(event)).toBe(false);
    });
  });

  describe('getModifierKeyDisplay', () => {
    it('should return "Alt" for Windows/Linux', () => {
      service.isMac.set(false);
      expect(service.getModifierKeyDisplay()).toBe('Alt');
    });

    it('should return "Cmd" for Mac (text mode)', () => {
      service.isMac.set(true);
      expect(service.getModifierKeyDisplay(false)).toBe('Cmd');
    });

    it('should return "⌘" for Mac (symbol mode)', () => {
      service.isMac.set(true);
      expect(service.getModifierKeyDisplay(true)).toBe('⌘');
    });
  });

  describe('formatShortcut', () => {
    it('should format shortcut for Windows/Linux', () => {
      service.isMac.set(false);
      expect(service.formatShortcut('C')).toBe('Alt+C');
    });

    it('should format shortcut for Mac (text mode)', () => {
      service.isMac.set(true);
      expect(service.formatShortcut('C', false)).toBe('Cmd+C');
    });

    it('should format shortcut for Mac (symbol mode)', () => {
      service.isMac.set(true);
      expect(service.formatShortcut('C', true)).toBe('⌘+C');
    });
  });
});
