import { Injectable } from '@angular/core';

// Region interface from location selection dialog
export interface Region {
  id: string;
  name: string;
  enabled: boolean;
  icon: string;
}

@Injectable({
  providedIn: 'root',
})
export class RegionService {
  // TODO: The RegionService will query the infrastructure to get load and capacity information for each region, ensuring
  // that new accounts are created in the least loaded region.

  #relayNames = [
    'Ribo',
    'Rilo',
    'Rifu',
    'Rixi',
    'Rova',
    'Ryma',
    'Robo',
    'Ruku',
    'Raze',
    'Ruby',
    'Ramu',
    'Rizo',
    'Rika',
    'Rulo',
    'Ruvi',
    'Rino',
    'Riby',
    'Rask',
    'Rofo',
    'Rilz',
    'Rudo',
    'Remo',
    'Rinz',
    'Rupi',
    'Rozi',
    'Ruco',
    'Rima',
    'Ropi',
    'Ruzo',
    'Riku',
    'Riry',
    'Riso',
    'Ruzz',
    'Ropo',
    'Ruzi',
    'Rilv',
    'Rork',
    'Ramy',
    'Rozo',
    'Rimp',
    'Runo',
    'Ripp',
    'Rino',
    'Riko',
    'Rufo',
    'Repo',
    'Romy',
    'Rilz',
    'Raku',
    'Rumo',
  ];

  #mediaNames = [
    'Mibo',
    'Milo',
    'Mifu',
    'Mixi',
    'Mova',
    'Myma',
    'Mobo',
    'Muku',
    'Maze',
    'Miby',
    'Mamu',
    'Mizo',
    'Mika',
    'Mulo',
    'Muvi',
    'Mino',
    'Miby',
    'Mask',
    'Mofo',
    'Milz',
    'Mudo',
    'Memo',
    'Minz',
    'Mupi',
    'Mozi',
    'Muco',
    'Mima',
    'Mopi',
    'Muzo',
    'Miku',
    'Miry',
    'Miso',
    'Muzz',
    'Mopo',
    'Muzi',
    'Milv',
    'Mork',
    'Mamy',
    'Mozo',
    'Mimp',
    'Muno',
    'Mipp',
    'Mino',
    'Miko',
    'Mufo',
    'Mepo',
    'Momy',
    'Milz',
    'Maku',
    'Mumo',
  ];

  regions: Region[] = [
    { id: 'eu', name: 'Europe', enabled: true, icon: 'euro_symbol' },
    { id: 'af', name: 'Africa', enabled: true, icon: 'public' },
    { id: 'us', name: 'North America', enabled: true, icon: 'north_america' },
    { id: 'sa', name: 'South America', enabled: false, icon: 'south_america' },
    { id: 'as', name: 'Asia', enabled: false, icon: 'asia' },
  ];

  // Default accounts by region - these are shown to new users with zero following
  // to provide immediate content access while they build their network
  private defaultAccountsByRegion: Record<string, string[]> = {
    eu: [
      'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria
      '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', // SondreB
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // Jack Dorsey
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // Saylor
      '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
      '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
      'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Pablo F7z
      '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross  
      '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411', // Karnage
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
      'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
      '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832', // ROCKSTAR
      '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
      'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0', // Jack Mallers
      '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
    ],
    us: [
      'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria
      '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', // SondreB
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // Jack Dorsey
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // Saylor
      '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
      '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
      'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Pablo F7z
      '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
      '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411', // Miljan
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
      'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
      '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832', // ROCKSTAR
      '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
      'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0', // Jack Mallers
      '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
    ],
    af: [
      'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria
      '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', // SondreB
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // Jack Dorsey
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // Saylor
      '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
      '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
      'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Pablo F7z
      '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
      '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411', // Miljan
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
      'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
      '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832', // ROCKSTAR
      '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
      'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0', // Jack Mallers
      '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
    ],
    sa: [
      'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria
      '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', // SondreB
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // Jack Dorsey
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // Saylor
      '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
      '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
      'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Pablo F7z
      '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
      '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411', // Miljan
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
      'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
      '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832', // ROCKSTAR
      '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
      'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0', // Jack Mallers
      '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
    ],
    as: [
      'd1bd33333733dcc411f0ee893b38b8522fc0de227fff459d99044ced9e65581b', // Nostria
      '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515', // SondreB
      '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // Jack Dorsey
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // Saylor
      '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
      '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
      'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', // Pablo F7z
      '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
      '1bc70a0148b3f316da33fe3c89f23e3e71ac4ff998027ec712b905cd24f6a411', // Miljan
      '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // Odell
      'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // Walker
      'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
      '91c9a5e1a9744114c6fe2d61ae4de82629eaaa0fb52f48288093c7e7e036f832', // ROCKSTAR
      '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
      'c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0', // Jack Mallers
      '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
    ],
  };

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
      return `wss://${instance.toLowerCase()}.${region.id}.nostria.app`;
    }

    return null;
  }

  isRegionEnabled(region: Region): boolean {
    return region.enabled;
  }

  /**
   * Get default accounts for a specific region
   * These are used when a user has zero following to provide immediate content access
   */
  getDefaultAccountsForRegion(regionId: string): string[] {
    return this.defaultAccountsByRegion[regionId] || this.defaultAccountsByRegion['us'];
  }
}
