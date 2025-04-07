import { Injectable, signal, computed, effect, inject } from '@angular/core';

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
  
  loginWithExtension(): void {
    // In a real implementation, you'd use window.nostr to request the public key
    // For now, we'll mock this behavior
    setTimeout(() => {
      const mockPubkey = `npub${Math.random().toString(36).substring(2, 15)}`;
      this.user.set({
        pubkey: mockPubkey,
        source: 'extension'
      });
    }, 500);
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
