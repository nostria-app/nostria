import { Injectable, signal } from '@angular/core';
import { SimplePool } from 'nostr-tools';

export interface ServerInfo {
  url: string;
  name: string;
  region: string;
  latency?: number;
}

@Injectable({
  providedIn: 'root',
})
export class DiscoveryRelayService {
  private servers: ServerInfo[] = [
    {
      url: 'https://proxy.eu.nostria.app/api/ping',
      name: 'proxy.eu.nostria.app',
      region: 'Europe',
    },
    {
      url: 'https://proxy.us.nostria.app/api/ping',
      name: 'proxy.us.nostria.app',
      region: 'USA',
    },
    // {
    //   url: 'https://proxy.af.nostria.app/api/ping',
    //   name: 'proxy.af.nostria.app',
    //   region: 'Africa',
    // },
    // { url: 'https://proxy.as.nostria.app/api/ping', name: 'proxy.as.nostria.app', region: 'Asia' },
    // { url: 'https://proxy.sa.nostria.app/api/ping', name: 'proxy.sa.nostria.app', region: 'South America' },
    // { url: 'https://proxy.au.nostria.app/api/ping', name: 'proxy.au.nostria.app', region: 'Australia' },
    // { url: 'https://proxy.jp.nostria.app/api/ping', name: 'proxy.jp.nostria.app', region: 'Japan' },
    // { url: 'https://proxy.cn.nostria.app/api/ping', name: 'proxy.cn.nostria.app', region: 'China' },
    // { url: 'https://proxy.in.nostria.app/api/ping', name: 'proxy.in.nostria.app', region: 'India' },
    // { url: 'https://proxy.me.nostria.app/api/ping', name: 'proxy.me.nostria.app', region: 'Middle East' },
  ];

  isChecking = signal<boolean>(false);
  selectedServer = signal<ServerInfo>(this.servers[0]);
  progress = signal<number>(0);
  discoveryPool: SimplePool | null = null;

  getDiscoveryPool(): SimplePool {
    return this.discoveryPool || (this.discoveryPool = new SimplePool());
  }

  async checkServerLatency(): Promise<ServerInfo> {
    // Initially only check the first 3 servers as requested
    const serversToCheck = this.servers;
    const results: ServerInfo[] = [];

    this.isChecking.set(true);
    this.progress.set(0);

    for (let i = 0; i < serversToCheck.length; i++) {
      const server = serversToCheck[i];
      try {
        const startTime = performance.now();
        await fetch(`${server.url}`, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-cache',
        });
        const endTime = performance.now();

        const serverWithLatency = {
          ...server,
          latency: Math.round(endTime - startTime),
        };

        results.push(serverWithLatency);
      } catch (error) {
        console.error(`Error checking ${server.name}:`, error);
        results.push({ ...server, latency: 9999 }); // High latency for failed servers
      }

      this.progress.set(Math.round(((i + 1) / serversToCheck.length) * 100));
    }

    // Sort by latency (lowest first) and select the best server
    results.sort((a, b) => (a.latency || 9999) - (b.latency || 9999));
    const bestServer = results[0];

    // Update all servers with their latency values
    this.servers = results;

    this.isChecking.set(false);
    this.selectedServer.set(bestServer);

    return bestServer;
  }

  getServersByLatency(): ServerInfo[] {
    return [...this.servers].sort((a, b) => (a.latency || 9999) - (b.latency || 9999));
  }

  getAllServers(): ServerInfo[] {
    return [...this.servers];
  }
}