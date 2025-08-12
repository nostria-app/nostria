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
export class DiscoveryService {
  private servers: ServerInfo[] = [
    {
      url: 'https://discovery.eu.nostria.app/',
      name: 'discovery.eu.nostria.app',
      region: 'Europe',
    },
    {
      url: 'https://discovery.us.nostria.app/',
      name: 'discovery.us.nostria.app',
      region: 'USA',
    },
    {
      url: 'https://discovery.af.nostria.app/',
      name: 'discovery.af.nostria.app',
      region: 'Africa',
    },
    // { url: 'https://discovery.as.nostria.app/', name: 'discovery.as.nostria.app', region: 'Asia' },
    // { url: 'https://discovery.sa.nostria.app/', name: 'discovery.sa.nostria.app', region: 'South America' },
    // { url: 'https://discovery.au.nostria.app/', name: 'discovery.au.nostria.app', region: 'Australia' },
    // { url: 'https://discovery.jp.nostria.app/', name: 'discovery.jp.nostria.app', region: 'Japan' },
    // { url: 'https://discovery.cn.nostria.app/', name: 'discovery.cn.nostria.app', region: 'China' },
    // { url: 'https://discovery.in.nostria.app/', name: 'discovery.in.nostria.app', region: 'India' },
    // { url: 'https://discovery.me.nostria.app/', name: 'discovery.me.nostria.app', region: 'Middle East' },
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
    return [...this.servers].sort(
      (a, b) => (a.latency || 9999) - (b.latency || 9999)
    );
  }

  getAllServers(): ServerInfo[] {
    return [...this.servers];
  }
}
