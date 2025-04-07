import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

export interface NostrUser {
  pubkey: string;
  privkey?: string;
  name?: string;
  source: 'generated' | 'extension' | 'nsec' | 'preview';
}

@Injectable({
  providedIn: 'root'
})
export class NostrService {
  private user = signal<NostrUser | null>(null);
  isLoggedIn = computed(() => !!this.user());
  currentUser = computed(() => this.user());
  
  constructor() {
    this.loadUserFromStorage();
    
    // Save user to localStorage whenever it changes
    effect(() => {
      const currentUser = this.user();
      if (currentUser) {
        localStorage.setItem('nostr_user', JSON.stringify(currentUser));
      }
    });
  }
  
  private loadUserFromStorage(): void {
    const userJson = localStorage.getItem('nostr_user');
    if (userJson) {
      try {
        this.user.set(JSON.parse(userJson));
      } catch (e) {
        console.error('Failed to parse user from localStorage', e);
      }
    }
  }
  
  generateNewKey(): void {
    // In a real implementation, you'd use a proper key generation library
    const mockPubkey = `npub${Math.random().toString(36).substring(2, 15)}`;
    const mockPrivkey = `nsec${Math.random().toString(36).substring(2, 15)}`;
    
    this.user.set({
      pubkey: mockPubkey,
      privkey: mockPrivkey,
      source: 'generated'
    });
  }
  
  async loginWithExtension(): Promise<void> {
    try {
      // Check if NIP-07 extension is available
      if (!window.nostr) {
        throw new Error('No Nostr extension found. Please install Alby, nos2x, or another NIP-07 compatible extension.');
      }
      
      // Get the public key from the extension
      const pubkey = await window.nostr.getPublicKey();
      
      if (!pubkey) {
        throw new Error('Failed to get public key from extension');
      }
      
      // Get user metadata if available
      let name: string | undefined = undefined;
      try {
        // Some extensions may provide user metadata like name
        const userInfo = await window.nostr.getUserMetadata();
        name = userInfo?.name;
      } catch (error) {
        // Ignore errors for metadata, it's optional
        console.warn('Could not get user metadata from extension', error);
      }
      
      // Set the user with the public key from the extension
      this.user.set({
        pubkey,
        name,
        source: 'extension'
      });
      
      return;
    } catch (error) {
      console.error('Error connecting to Nostr extension:', error);
      throw error; // Re-throw to handle in the UI
    }
  }
  
  loginWithNsec(nsec: string): void {
    // In a real implementation, you'd validate and convert the nsec to a pubkey
    // For now, we'll mock this behavior
    const mockPubkey = `npub${Math.random().toString(36).substring(2, 15)}`;
    
    this.user.set({
      pubkey: mockPubkey,
      privkey: nsec,
      source: 'nsec'
    });
  }
  
  usePreviewAccount(): void {
    const previewPubkey = 'npub1preview0000000000000000000000000';
    this.user.set({
      pubkey: previewPubkey,
      name: 'Preview User',
      source: 'preview'
    });
  }
  
  logout(): void {
    localStorage.removeItem('nostr_user');
    this.user.set(null);
  }
}
