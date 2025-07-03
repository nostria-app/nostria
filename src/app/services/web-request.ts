import { inject, Injectable } from '@angular/core';
import { NostrService } from './nostr.service';

export interface AuthenticationInit {
  // method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  reason?: string;
  nip98?: boolean;

  /** Use 24242 for Blossom, 27235 for HTTP Auth */
  kind: 27235 | 24242;
  // headers?: Record<string, string>;
  // body?: any;
}

@Injectable({
  providedIn: 'root'
})
export class WebRequest {
  nostr = inject(NostrService);

  constructor() { }

  async fetchText(url: string, options?: RequestInit, auth?: AuthenticationInit): Promise<string> {
    try {
      const response = await this.fetch(url, options, auth);
      return await response.text();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async fetchJson(url: string, options?: RequestInit, auth?: AuthenticationInit): Promise<any> {
    try {

      if (!options) {
        options = {};
      }

      if (!options.headers) {
        options.headers = {};
      }

      // Set the Content-Type header to application/json
      (options.headers as Record<string, string>)['Content-Type'] = 'application/json';

      const response = await this.fetch(url, options, auth);
      return await response.json();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async fetch(url: string, options?: RequestInit, auth?: AuthenticationInit): Promise<Response> {
    try {
      if (auth) {
        // Use NIP-98 authentication if available
        const authHeader = await this.nostr.getNIP98AuthToken({
          url: url,
          method: options?.method || 'GET',
        });

        if (!options) {
          options = {};
        }

        if (!options.headers) {
          options.headers = {};
        }

        // Set the Authorization header
        (options.headers as Record<string, string>)['Authorization'] = `Nostr ${authHeader}`;
      }

      console.log('WebRequest.fetch', url, options)
      const response = await fetch(url, options);

      // const response = await fetch(url, {
      //   method: 'POST',
      //   headers: {
      //     ...headers,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify(subscriptionWithUserAgent)
      // });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
