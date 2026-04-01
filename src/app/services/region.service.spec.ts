import { describe, expect, it } from 'vitest';
import { RegionService } from './region.service';

describe('RegionService', () => {
  it('generates flat Nostria relay hosts for Europe and USA', () => {
    const service = new RegionService();

    expect(service.getRelayServer('eu', 0)).toBe('wss://ribo.nostria.app/');
    expect(service.getRelayServer('us', 0)).toBe('wss://rilo.nostria.app/');
    expect(service.getRelayServer('eu', 2)).toBe('wss://rifu.nostria.app/');
    expect(service.getRelayServer('us', 2)).toBe('wss://rifu.nostria.app/');
  });

  it('generates flat Nostria media hosts for Europe and USA', () => {
    const service = new RegionService();

    expect(service.getMediaServer('eu', 0)).toBe('https://mibo.nostria.app');
    expect(service.getMediaServer('us', 0)).toBe('https://milo.nostria.app');
    expect(service.getMediaServer('eu', 2)).toBe('https://mifu.nostria.app');
    expect(service.getMediaServer('us', 2)).toBe('https://mifu.nostria.app');
  });

  it('rewrites legacy eu and us Nostria relay hosts to the flat hostnames', () => {
    const service = new RegionService();

    expect(service.rewriteRelayUrl('wss://ribo.eu.nostria.app')).toBe('wss://ribo.nostria.app/');
    expect(service.rewriteRelayUrl('wss://rilo.us.nostria.app')).toBe('wss://rilo.nostria.app/');
    expect(service.rewriteMediaServerUrl('https://mibo.eu.nostria.app')).toBe('https://mibo.nostria.app/');
    expect(service.rewriteMediaServerUrl('https://milo.us.nostria.app')).toBe('https://milo.nostria.app/');
  });
});