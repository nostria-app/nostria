import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface AndroidSignerPermission {
  type: 'sign_event' | 'nip04_encrypt' | 'nip04_decrypt' | 'nip44_encrypt' | 'nip44_decrypt' | 'decrypt_zap_event';
  kind?: number;
}

export interface AndroidSignerPublicKeyResponse {
  pubkey: string;
  packageName: string;
}

interface AndroidSignerCommandResponse {
  result: string;
  packageName?: string | null;
  id?: string | null;
  event?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AndroidSignerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private interactionQueue: Promise<void> = Promise.resolve();

  private readonly defaultPermissions: AndroidSignerPermission[] = [
    { type: 'sign_event' },
    { type: 'nip04_encrypt' },
    { type: 'nip04_decrypt' },
    { type: 'nip44_encrypt' },
    { type: 'nip44_decrypt' },
    { type: 'decrypt_zap_event' },
  ];

  isSupported(): boolean {
    return this.isBrowser && isTauri() && /Android/i.test(navigator.userAgent);
  }

  getDefaultPermissions(): AndroidSignerPermission[] {
    return [...this.defaultPermissions];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    return this.invokePlugin<boolean>('is_available');
  }

  async getPublicKey(permissions = this.getDefaultPermissions()): Promise<AndroidSignerPublicKeyResponse> {
    this.ensureSupported();

    const response = await this.runExclusive(() =>
      this.invokePlugin<AndroidSignerPublicKeyResponse>('get_public_key', { permissions })
    );

    if (!response.pubkey || !response.packageName) {
      throw new Error('Android signer did not return a public key and package name.');
    }

    return response;
  }

  async signEvent(
    eventJson: string,
    currentUser: string,
    signerPackage: string,
    id?: string,
  ): Promise<AndroidSignerCommandResponse> {
    this.ensureSupported();

    return this.runExclusive(() =>
      this.invokePlugin<AndroidSignerCommandResponse>('sign_event', {
        content: eventJson,
        currentUser,
        signerPackage,
        id,
      })
    );
  }

  async encryptNip04(
    plaintext: string,
    pubkey: string,
    currentUser: string,
    signerPackage: string,
    id?: string,
  ): Promise<string> {
    const response = await this.runExclusive(() =>
      this.invokePlugin<AndroidSignerCommandResponse>('nip04_encrypt', {
        content: plaintext,
        pubkey,
        currentUser,
        signerPackage,
        id,
      })
    );

    return this.extractResult(response, 'NIP-04 encryption');
  }

  async decryptNip04(
    ciphertext: string,
    pubkey: string,
    currentUser: string,
    signerPackage: string,
    id?: string,
  ): Promise<string> {
    const response = await this.runExclusive(() =>
      this.invokePlugin<AndroidSignerCommandResponse>('nip04_decrypt', {
        content: ciphertext,
        pubkey,
        currentUser,
        signerPackage,
        id,
      })
    );

    return this.extractResult(response, 'NIP-04 decryption');
  }

  async encryptNip44(
    plaintext: string,
    pubkey: string,
    currentUser: string,
    signerPackage: string,
    id?: string,
  ): Promise<string> {
    const response = await this.runExclusive(() =>
      this.invokePlugin<AndroidSignerCommandResponse>('nip44_encrypt', {
        content: plaintext,
        pubkey,
        currentUser,
        signerPackage,
        id,
      })
    );

    return this.extractResult(response, 'NIP-44 encryption');
  }

  async decryptNip44(
    ciphertext: string,
    pubkey: string,
    currentUser: string,
    signerPackage: string,
    id?: string,
  ): Promise<string> {
    const response = await this.runExclusive(() =>
      this.invokePlugin<AndroidSignerCommandResponse>('nip44_decrypt', {
        content: ciphertext,
        pubkey,
        currentUser,
        signerPackage,
        id,
      })
    );

    return this.extractResult(response, 'NIP-44 decryption');
  }

  private async invokePlugin<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(`plugin:android-signer|${command}`, args);
    } catch (error) {
      throw this.toError(error, command);
    }
  }

  private extractResult(response: AndroidSignerCommandResponse, operation: string): string {
    if (!response.result) {
      throw new Error(`${operation} did not return a result.`);
    }

    return response.result;
  }

  private ensureSupported(): void {
    if (!this.isSupported()) {
      throw new Error('Android signer is only available in the Android Tauri app.');
    }
  }

  private toError(error: unknown, command: string): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    if (error && typeof error === 'object') {
      const structuredError = error as {
        message?: unknown;
        error?: unknown;
        code?: unknown;
        data?: unknown;
      };

      const message = [structuredError.message, structuredError.error, structuredError.code]
        .find((value): value is string => typeof value === 'string' && value.length > 0);

      if (message) {
        return new Error(message);
      }

      return new Error(`Android signer command '${command}' failed.`);
    }

    return new Error(`Android signer command '${command}' failed.`);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.interactionQueue
      .catch(() => undefined)
      .then(operation);

    this.interactionQueue = result.then(() => undefined, () => undefined);

    return result;
  }
}