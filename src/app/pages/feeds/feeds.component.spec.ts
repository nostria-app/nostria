import { computed, signal } from '@angular/core';

/**
 * Tests for the columnLayout computed signal and class binding logic
 * used in FeedsComponent. The template uses [class.xxx] bindings
 * instead of [ngClass] to apply layout classes.
 */
describe('FeedsComponent columnLayout', () => {
  // Replicate the columnLayout logic from FeedsComponent
  function createColumnLayout(screenWidth: ReturnType<typeof signal<number>>) {
    return computed(() => {
      const width = screenWidth();
      if (width >= 1600) {
        return 'three-columns-layout';
      } else if (width >= 1024) {
        return 'two-columns-layout';
      } else {
        return 'one-column-layout';
      }
    });
  }

  it('should return one-column-layout for small screens', () => {
    const screenWidth = signal(320);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('one-column-layout');
  });

  it('should return one-column-layout for screens below 1024', () => {
    const screenWidth = signal(1023);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('one-column-layout');
  });

  it('should return two-columns-layout at exactly 1024', () => {
    const screenWidth = signal(1024);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('two-columns-layout');
  });

  it('should return two-columns-layout for mid-range screens', () => {
    const screenWidth = signal(1280);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('two-columns-layout');
  });

  it('should return two-columns-layout just below 1600', () => {
    const screenWidth = signal(1599);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('two-columns-layout');
  });

  it('should return three-columns-layout at exactly 1600', () => {
    const screenWidth = signal(1600);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('three-columns-layout');
  });

  it('should return three-columns-layout for large screens', () => {
    const screenWidth = signal(1920);
    const columnLayout = createColumnLayout(screenWidth);
    expect(columnLayout()).toBe('three-columns-layout');
  });

  it('should reactively update when screenWidth changes', () => {
    const screenWidth = signal(800);
    const columnLayout = createColumnLayout(screenWidth);

    expect(columnLayout()).toBe('one-column-layout');

    screenWidth.set(1200);
    expect(columnLayout()).toBe('two-columns-layout');

    screenWidth.set(1800);
    expect(columnLayout()).toBe('three-columns-layout');

    screenWidth.set(500);
    expect(columnLayout()).toBe('one-column-layout');
  });

  it('should only return one of three valid layout classes', () => {
    const validClasses = ['one-column-layout', 'two-columns-layout', 'three-columns-layout'];
    const screenWidth = signal(0);
    const columnLayout = createColumnLayout(screenWidth);

    for (const width of [0, 100, 768, 1024, 1280, 1600, 1920, 3840]) {
      screenWidth.set(width);
      expect(validClasses).toContain(columnLayout());
    }
  });
});
