import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

import { IntersectionObserverService } from './intersection-observer.service';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    _callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit
  ) {
    MockIntersectionObserver.instances.push(this);
  }
}

describe('IntersectionObserverService', () => {
  let service: IntersectionObserverService;
  let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;

  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

  beforeEach(() => {
    TestBed.resetTestingModule();
    MockIntersectionObserver.instances = [];
    originalIntersectionObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;

    TestBed.configureTestingModule({});
    service = TestBed.inject(IntersectionObserverService);
  });

  afterEach(() => {
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      return;
    }

    delete (globalThis as { IntersectionObserver?: typeof globalThis.IntersectionObserver }).IntersectionObserver;
  });

  it('reuses observers for matching root and options', () => {
    const root = {} as Element;
    const first = {} as Element;
    const second = {} as Element;

    service.observe(first, vi.fn(), { root, rootMargin: '100px', threshold: 0.25 });
    service.observe(second, vi.fn(), { root, rootMargin: '100px', threshold: 0.25 });

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    expect(MockIntersectionObserver.instances[0].options?.root).toBe(root);
  });

  it('creates separate observers for different roots', () => {
    const firstRoot = {} as Element;
    const secondRoot = {} as Element;

    service.observe({} as Element, vi.fn(), { root: firstRoot });
    service.observe({} as Element, vi.fn(), { root: secondRoot });

    expect(MockIntersectionObserver.instances).toHaveLength(2);
  });

  it('supports multiple observer registrations for the same element', () => {
    const root = {} as Element;
    const element = {} as Element;

    service.observe(element, vi.fn(), { root, rootMargin: '0px' });
    service.observe(element, vi.fn(), { root, rootMargin: '1200px 0px 1800px 0px' });

    expect(MockIntersectionObserver.instances).toHaveLength(2);
    expect(service.getObservedCount()).toBe(2);
  });
});
