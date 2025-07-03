import { Injectable } from '@angular/core';

// Region interface from location selection dialog
export interface Region {
  id: string;
  name: string;
  enabled: boolean;
  icon: string;
}

@Injectable({
  providedIn: 'root'
})
export class RegionService {
  // TODO: The RegionService will query the infrastructure to get load and capacity information for each region, ensuring
  // that new accounts are created in the least loaded region.

  #relayNames = [
    'Ribo', 'Rilo', 'Rifu', 'Rixi', 'Rova', 'Ryma', 'Robo', 'Ruku', 'Raze', 'Ruby',
    'Ramu', 'Rizo', 'Rika', 'Rulo', 'Ruvi', 'Rino', 'Riby', 'Rask', 'Rofo', 'Rilz',
    'Rudo', 'Remo', 'Rinz', 'Rupi', 'Rozi', 'Ruco', 'Rima', 'Ropi', 'Ruzo', 'Riku',
    'Riry', 'Riso', 'Ruzz', 'Ropo', 'Ruzi', 'Rilv', 'Rork', 'Ramy', 'Rozo', 'Rimp',
    'Runo', 'Ripp', 'Rino', 'Riko', 'Rufo', 'Repo', 'Romy', 'Rilz', 'Raku', 'Rumo'
  ];

  #mediaNames = [
    'Mibo', 'Milo', 'Mifu', 'Mixi', 'Mova', 'Myma', 'Mobo', 'Muku', 'Maze', 'Miby',
    'Mamu', 'Mizo', 'Mika', 'Mulo', 'Muvi', 'Mino', 'Miby', 'Mask', 'Mofo', 'Milz',
    'Mudo', 'Memo', 'Minz', 'Mupi', 'Mozi', 'Muco', 'Mima', 'Mopi', 'Muzo', 'Miku',
    'Miry', 'Miso', 'Muzz', 'Mopo', 'Muzi', 'Milv', 'Mork', 'Mamy', 'Mozo', 'Mimp',
    'Muno', 'Mipp', 'Mino', 'Miko', 'Mufo', 'Mepo', 'Momy', 'Milz', 'Maku', 'Mumo'
  ];

  constructor() { }

  regions: Region[] = [
    { id: 'eu', name: 'Europe', enabled: true, icon: 'euro_symbol' },
    { id: 'af', name: 'Africa', enabled: true, icon: 'public' },
    { id: 'us', name: 'North America', enabled: true, icon: 'north_america' },
    { id: 'sa', name: 'South America', enabled: false, icon: 'south_america' },
    { id: 'as', name: 'Asia', enabled: false, icon: 'asia' }
  ];

  getDiscoveryRelay(regionId: string) {
    return `wss://discovery.${regionId}.nostria.app/`;
  }

  getMediaServer(regionId: string, instanceId: number): string | null {
    const region = this.regions.find(r => r.id === regionId);
    const instance = this.#mediaNames[instanceId];

    if (region) {
      return `https://${instance.toLowerCase()}.${region.id}.nostria.app`;
    }

    return null;
  }

  getRelayServer(regionId: string, instanceId: number): string | null {
    const region = this.regions.find(r => r.id === regionId);
    const instance = this.#relayNames[instanceId];

    if (region) {
      return `https://${instance.toLowerCase()}.${region.id}.nostria.app`;
    }

    return null;
  }

  isRegionEnabled(region: Region): boolean {
    return region.enabled;
  }
}
